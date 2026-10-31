import { app } from 'electron'

// Imported first by index.ts so it runs before any store touches the userData folder.
// Lets tests (and portable setups) keep settings in a custom folder.
if (process.env.STRATA_USER_DATA) app.setPath('userData', process.env.STRATA_USER_DATA)
