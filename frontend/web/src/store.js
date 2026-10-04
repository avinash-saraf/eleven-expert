import { configureStore, createListenerMiddleware } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'
import { apprenticeApi } from './api.js'
import { authReducer, signedOut, persistAuth } from './auth.js'

const listener = createListenerMiddleware()
listener.startListening({
  actionCreator: signedOut,
  effect: (_, { dispatch }) => {
    dispatch(apprenticeApi.util.resetApiState())
  },
})
export const store = configureStore({
  reducer: {
    auth: authReducer,
    [apprenticeApi.reducerPath]: apprenticeApi.reducer,
  },
  middleware: (getDefault) =>
    getDefault().prepend(listener.middleware).concat(apprenticeApi.middleware),
})
let previous = store.getState().auth
store.subscribe(() => {
  const current = store.getState().auth
  if (current !== previous) {
    previous = current
    persistAuth(current)
  }
})
setupListeners(store.dispatch)
