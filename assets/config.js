// Alora portal configuration.
// The anon key is designed to be public. Your data is protected by the
// database rules in supabase/schema.sql, not by hiding this key.
window.ALORA_CONFIG = {
  supabaseUrl: 'https://vahlgpyvakkystoclssl.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhaGxncHl2YWtreXN0b2Nsc3NsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NjE1NjMsImV4cCI6MjA5NjIzNzU2M30.YIaHYLlHSuuS40o5j4qsBL2NWrLtOPHvxTT2Nl7Fwms',
  // How many areas get extra attention per visit when you don't pick them yourself
  prioritiesPerVisit: 2,
};
