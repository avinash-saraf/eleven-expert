import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { signedOut } from './auth.js'

export const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(
  /\/$/,
  '',
)
const rawBaseQuery = fetchBaseQuery({
  baseUrl: apiBase,
  timeout: 45000,
  prepareHeaders: (headers, { getState, endpoint }) => {
    const token = getState().auth.accessToken
    if (token && endpoint !== 'login')
      headers.set('Authorization', `Bearer ${token}`)
    return headers
  },
})
const baseQuery = async (args, api, options) => {
  const token = api.getState().auth.accessToken
  const result = await rawBaseQuery(args, api, options)
  if (
    result.error?.status === 401 &&
    token === api.getState().auth.accessToken &&
    api.endpoint !== 'login'
  )
    api.dispatch(signedOut())
  return result
}
const sessionPath = ({ workflowId, sessionId }) =>
  `workflows/${workflowId}/sessions/${sessionId}`

export const apprenticeApi = createApi({
  reducerPath: 'apprenticeApi',
  baseQuery,
  tagTypes: ['Workflow', 'Session', 'Events'],
  refetchOnReconnect: true,
  endpoints: (build) => ({
    login: build.mutation({
      query: (body) => ({ url: 'auth/demo-login', method: 'POST', body }),
    }),
    me: build.query({ query: () => 'auth/me' }),
    workflows: build.query({
      query: () => 'workflows',
      providesTags: (items = []) => [
        { type: 'Workflow', id: 'LIST' },
        ...items.map((w) => ({ type: 'Workflow', id: w.id })),
      ],
    }),
    workflow: build.query({
      query: (id) => `workflows/${id}`,
      providesTags: (_, __, id) => [{ type: 'Workflow', id }],
    }),
    createWorkflow: build.mutation({
      query: ({ title }) => ({
        url: 'workflows',
        method: 'POST',
        body: { title },
      }),
      invalidatesTags: [{ type: 'Workflow', id: 'LIST' }],
    }),
    rebuildGraph: build.mutation({
      query: (id) => ({ url: `workflows/${id}/graph/rebuild`, method: 'POST' }),
      invalidatesTags: (_, __, id) => [{ type: 'Workflow', id }],
    }),
    sessions: build.query({
      query: (workflowId) => `workflows/${workflowId}/sessions`,
      providesTags: (_, __, workflowId) => [
        { type: 'Session', id: `LIST:${workflowId}` },
      ],
    }),
    session: build.query({
      query: sessionPath,
      providesTags: (_, __, { sessionId }) => [
        { type: 'Session', id: sessionId },
      ],
    }),
    createSession: build.mutation({
      query: ({ workflowId, meetingUrl, requestKey }) => ({
        url: `workflows/${workflowId}/sessions`,
        method: 'POST',
        body: { meetingUrl },
        headers: { 'Idempotency-Key': requestKey },
      }),
      invalidatesTags: (_, __, { workflowId }) => [
        { type: 'Session', id: `LIST:${workflowId}` },
      ],
    }),
    stopSession: build.mutation({
      query: (args) => ({ url: `${sessionPath(args)}/stop`, method: 'POST' }),
      invalidatesTags: (_, __, { workflowId, sessionId }) => [
        { type: 'Session', id: sessionId },
        { type: 'Session', id: `LIST:${workflowId}` },
        { type: 'Workflow', id: workflowId },
        { type: 'Workflow', id: 'LIST' },
        { type: 'Events', id: sessionId },
      ],
    }),
    media: build.query({ query: (args) => `${sessionPath(args)}/media` }),
    apprentice: build.query({
      query: (args) => `${sessionPath(args)}/apprentice`,
    }),
    events: build.query({
      query: ({ before, ...args }) => ({
        url: `${sessionPath(args)}/events`,
        params: before ? { before } : undefined,
      }),
      providesTags: (_, __, { sessionId }) => [
        { type: 'Events', id: sessionId },
      ],
    }),
  }),
})

export const {
  useLoginMutation,
  useMeQuery,
  useWorkflowsQuery,
  useWorkflowQuery,
  useCreateWorkflowMutation,
  useRebuildGraphMutation,
  useSessionsQuery,
  useSessionQuery,
  useCreateSessionMutation,
  useStopSessionMutation,
  useMediaQuery,
  useApprenticeQuery,
  useEventsQuery,
  useLazyEventsQuery,
} = apprenticeApi

export function errorMessage(error) {
  const message = error?.data?.message
  if (Array.isArray(message)) return message.join(' ')
  if (typeof message === 'string') return message
  if (error?.status === 'FETCH_ERROR')
    return 'Cannot reach the backend. Check that it is running and the API URL is correct.'
  if (error?.status === 'TIMEOUT_ERROR')
    return 'The request timed out. Check the session list before trying to create another bot.'
  return error?.error || 'The request failed. Please try again.'
}
