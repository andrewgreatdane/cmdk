// Fill these in to switch the admin from demo mode (browser-only) to the shared Supabase database.
// The publishable/anon key is safe to ship: row level security limits all data to listed admins.
window.RS_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_KEY: '',
  // Shown on the demo login; in live mode the names come from the admins table.
  ADMINS: [
    { email: 'andrew@unhingedventures.com', name: 'Andrew' },
    { email: 'alex@demo.local', name: 'Alex' },
    { email: 'grey@demo.local', name: 'Mr. Grey' },
  ],
};
