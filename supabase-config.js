/* Nourish – Supabase connection (loaded after the Supabase library, before auth.js).
   Paste your anon (publishable) key below. Never put the service_role key in front-end code. */
(function () {
  "use strict";
  var SUPABASE_URL = "https://kejrcrsjspjwktsdxeja.supabase.co";
  var SUPABASE_KEY = "sb_publishable_MoLHNl0Km00la5c8R65ZHQ_CG3ykJsY";

  if (!window.supabase || !window.supabase.createClient) {
    console.warn("Supabase library did not load (offline or blocked). Falling back to browser-only storage.");
    window.nourishDB = null;
    return;
  }
  if (SUPABASE_KEY.indexOf("YOUR_")===0) {
    console.warn("Supabase key not set yet: edit supabase-config.js");
    window.nourishDB = null;
    return;
  }
  window.nourishDB = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
})();
