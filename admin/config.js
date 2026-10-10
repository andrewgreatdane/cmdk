// Fill these in to switch the admin from demo mode (browser-only) to the shared Supabase database.
// The publishable/anon key is safe to ship: row level security limits all data to listed admins.
window.RS_CONFIG = {
  SUPABASE_URL: 'https://domzsdxeencwxyblsptm.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvbXpzZHhlZW5jd3h5YmxzcHRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NTU3NTcsImV4cCI6MjEwNzIzMTc1N30.Ipf9JTyhX6ixd5_aCmmhd8eZ78MHSJHGhSju9dGAP3c',
  // Shown on the demo login; in live mode the names come from the admins table.
  ADMINS: [
    { email: 'andrew@unhingedventures.com', name: 'Andrew' },
    { email: 'alex@demo.local', name: 'Alex' },
    { email: 'grey@demo.local', name: 'Mr. Grey' },
  ],
};
