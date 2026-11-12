/** Test-only: the app's env check wants an API URL when a screen module that talks to the server is imported. Nothing is called. */
process.env.VITE_SERVER_URL ??= "http://localhost:3000";
