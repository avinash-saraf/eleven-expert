import { createSlice } from '@reduxjs/toolkit'

const KEY = 'apprentice-auth-v2'
function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    if (
      saved?.accessToken &&
      saved?.user?.id &&
      Date.parse(saved.expiresAt) > Date.now()
    )
      return saved
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return { accessToken: null, user: null, expiresAt: null }
}

const slice = createSlice({
  name: 'auth',
  initialState: restore(),
  reducers: {
    signedIn: (_, { payload }) => ({
      accessToken: payload.accessToken,
      user: payload.user,
      expiresAt: payload.expiresAt,
    }),
    identityUpdated: (state, { payload }) => {
      state.user = payload
    },
    signedOut: () => ({ accessToken: null, user: null, expiresAt: null }),
  },
})
export const { signedIn, signedOut, identityUpdated } = slice.actions
export const authReducer = slice.reducer
export function persistAuth(state) {
  try {
    if (state.accessToken) localStorage.setItem(KEY, JSON.stringify(state))
    else localStorage.removeItem(KEY)
  } catch {
    /* The current tab still works without persisted login. */
  }
}
