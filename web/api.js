// Kaamghor api.js: settings and every call the app makes to Supabase.
// The anon key is public by design; the database rules (RLS + SQL functions) protect the data.

const KAAMGHOR_CONFIG = {
  SUPABASE_URL: 'https://zerlnrpjlcfmdhhpftgs.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcmxucnBqbGNmbWRoaHBmdGdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNzM4OTcsImV4cCI6MjEwODY0OTg5N30.i4PA_LQ5AqEDstPLiygHX2aVI77nsf2eaPiuQ8IqD7s',
};

const sb = supabase.createClient(KAAMGHOR_CONFIG.SUPABASE_URL, KAAMGHOR_CONFIG.SUPABASE_ANON_KEY, {
  // PKCE: after Google sign-in, Supabase sends the user back with ?code=..., which the client exchanges for a session.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

// Unwraps a Supabase response: returns data or throws the error.
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// Sort used everywhere workers are listed: verified first, then best rated, then most experienced.
function rankWorkers(list) {
  return list.slice().sort((a, b) =>
    (b.verified - a.verified) ||
    ((b.rating_avg ?? 0) - (a.rating_avg ?? 0)) ||
    (b.jobs_done - a.jobs_done));
}

const api = {
  // ---------- login ----------
  signInGoogle: () => q(sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  })),
  // Emails a one-time code (the Supabase email template must include {{ .Token }}).
  sendEmailCode: (email) => q(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })),
  verifyEmailCode: (email, token) => q(sb.auth.verifyOtp({ email, token, type: 'email' })),
  // Mobile: sign in by SMS code, or add/change a verified number on an existing account.
  sendPhoneCode: (phone) => q(sb.auth.signInWithOtp({ phone })),
  verifyPhoneCode: (phone, token) => q(sb.auth.verifyOtp({ phone, token, type: 'sms' })),
  startPhoneChange: (phone) => q(sb.auth.updateUser({ phone })),
  confirmPhoneChange: (phone, token) => q(sb.auth.verifyOtp({ phone, token, type: 'phone_change' })),
  // Copies the verified Auth phone onto the profile (the browser can't write it).
  syncPhone: () => q(sb.rpc('sync_my_phone')),
  signOut: () => sb.auth.signOut(),
  session: async () => (await sb.auth.getSession()).data.session,

  // ---------- profiles ----------
  myProfile: (uid) => q(sb.from('profiles').select('*').eq('id', uid).maybeSingle()),
  createProfile: (row) => q(sb.from('profiles').insert(row)),
  updateProfile: (uid, row) => q(sb.from('profiles').update(row).eq('id', uid)),
  profileById: (id) => q(sb.from('profiles').select('id, full_name, phone, area').eq('id', id).maybeSingle()),

  myWorker: (uid) => q(sb.from('worker_profiles').select('*').eq('user_id', uid).maybeSingle()),
  createWorker: (row) => q(sb.from('worker_profiles').insert(row)),
  updateWorker: (uid, row) => q(sb.from('worker_profiles').update(row).eq('user_id', uid)),

  publicWorker: (id) => q(sb.from('public_workers').select('*').eq('id', id).maybeSingle()),
  matchingWorkers: async (service, area) => rankWorkers(await q(sb.from('public_workers').select('*')
    .contains('skills', [service]).eq('area', area).eq('available', true).limit(50))),
  countMatching: async (service, area) => {
    const { count, error } = await sb.from('public_workers').select('id', { count: 'exact', head: true })
      .contains('skills', [service]).eq('area', area).eq('available', true);
    if (error) throw error;
    return count;
  },

  // ---------- household ----------
  postJob: (row) => q(sb.from('jobs').insert(row).select('id').single()),
  rates: () => q(sb.from('rates').select('*')),
  // Exact pin and landmark: only the household, the people it hired and admins can read them.
  setJobLocation: (jobId, lat, lng, landmark) => q(sb.rpc('set_job_location', { p_job: jobId, p_lat: lat, p_lng: lng, p_landmark: landmark })),
  jobLocation: (jobId) => q(sb.from('job_locations').select('*').eq('job_id', jobId).maybeSingle()),
  // Open jobs are readable by every signed-in user, so always filter by household.
  myPostedJobs: (uid) => q(sb.from('jobs').select('*').eq('household_id', uid).order('created_at', { ascending: false }).limit(100)),
  job: (id) => q(sb.from('jobs').select('*').eq('id', id).maybeSingle()),
  applicants: async (jobId) => {
    const apps = await q(sb.from('applications').select('worker_id, crew_size').eq('job_id', jobId));
    if (!apps.length) return [];
    const crew = Object.fromEntries(apps.map((a) => [a.worker_id, a.crew_size || 1]));
    const workers = await q(sb.from('public_workers').select('*').in('id', apps.map((a) => a.worker_id)));
    return rankWorkers(workers.map((w) => ({ ...w, crew_size: crew[w.id] })));
  },
  hire: (jobId, workerId) => q(sb.rpc('hire_worker', { p_job: jobId, p_worker: workerId })),
  stopHiring: (jobId) => q(sb.rpc('stop_hiring', { p_job: jobId })),
  // Two-way handshake: the household confirms the worker's arrival and the finished work.
  confirmArrival: (assignmentId) => q(sb.rpc('confirm_arrival', { p_assignment: assignmentId })),
  confirmCompletion: (assignmentId) => q(sb.rpc('confirm_completion', { p_assignment: assignmentId })),
  reportProblem: (assignmentId, problem) => q(sb.rpc('report_problem', { p_assignment: assignmentId, p_problem: problem })),
  // Confirms work whose household didn't respond within 24 hours (also runs on a schedule).
  autoComplete: () => q(sb.rpc('auto_complete_due')),
  // Everyone hired for a job (one assignment per person).
  jobAssignments: (jobId) => q(sb.from('assignments').select('*').eq('job_id', jobId).neq('status', 'cancelled').order('hired_at')),
  profilesByIds: (ids) => q(sb.from('profiles').select('id, full_name, phone, area').in('id', ids)),
  publicWorkersByIds: (ids) => q(sb.from('public_workers').select('*').in('id', ids)),
  jobPayments: (jobId) => q(sb.from('payments').select('*').eq('job_id', jobId)),
  paymentById: (id) => q(sb.from('payments').select('*').eq('id', id).maybeSingle()),
  // Two-way ratings: either side rates the other once the work is confirmed.
  ratePerson: (assignmentId, stars, tags, comment) => q(sb.rpc('rate_person', { p_assignment: assignmentId, p_stars: stars, p_tags: tags, p_comment: comment })),
  ratingsFor: (assignmentIds) => q(sb.from('ratings').select('*').in('assignment_id', assignmentIds)),
  // Public profile (no phone) and reviews, for anyone signed in.
  publicProfile: (id) => q(sb.from('public_profiles').select('*').eq('id', id).maybeSingle()),
  publicProfilesByIds: (ids) => q(sb.from('public_profiles').select('*').in('id', ids)),
  reviews: (id) => q(sb.from('public_reviews').select('*').eq('ratee_id', id).order('created_at', { ascending: false }).limit(30)),
  payTarget: async (jobId, workerId) => (await q(sb.rpc('get_pay_target', { p_job: jobId, p_worker: workerId })))[0],
  // One Razorpay order per person's payment.
  createOrder: async (paymentId) => {
    const { data, error } = await sb.functions.invoke('create-order', { body: { payment_id: paymentId } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch (_) { /* not JSON */ }
      throw new Error(msg);
    }
    return data;
  },

  // ---------- worker ----------
  openJobs: (skills, area) => {
    let req = sb.from('jobs').select('*').eq('status', 'open').in('service', skills);
    if (area) req = req.eq('area', area);
    return q(req.order('job_date', { ascending: true }).limit(100));
  },
  myApplications: async (uid) => (await q(sb.from('applications').select('job_id').eq('worker_id', uid))).map((a) => a.job_id),
  // crew > 1: a Thikadar applying with their crew.
  apply: (jobId, uid, crew = 1) => q(sb.from('applications').insert({ job_id: jobId, worker_id: uid, crew_size: crew })),
  setCrew: (assignmentId, names) => q(sb.rpc('set_crew', { p_assignment: assignmentId, p_names: names })),
  withdraw: (jobId, uid) => q(sb.from('applications').delete().eq('job_id', jobId).eq('worker_id', uid)),
  // My assignments, each with its job.
  myWork: (uid) => q(sb.from('assignments').select('*, jobs(*)').eq('worker_id', uid).neq('status', 'cancelled').order('hired_at', { ascending: false }).limit(100)),
  myAssignment: (jobId, uid) => q(sb.from('assignments').select('*').eq('job_id', jobId).eq('worker_id', uid).maybeSingle()),
  paymentForAssignment: (assignmentId) => q(sb.from('payments').select('*').eq('assignment_id', assignmentId).maybeSingle()),
  markArrived: (jobId) => q(sb.rpc('mark_arrived', { p_job: jobId })),
  complete: (jobId) => q(sb.rpc('complete_job', { p_job: jobId })),
  confirmCash: (jobId) => q(sb.rpc('confirm_cash', { p_job: jobId })),
  confirmDirect: (jobId) => q(sb.rpc('confirm_direct', { p_job: jobId })),
  uploadIdDoc: async (uid, blob, ext) => {
    const path = `${uid}/${Date.now()}.${ext}`;
    await q(sb.storage.from('id-docs').upload(path, blob, { contentType: blob.type, upsert: false }));
    await api.updateWorker(uid, { id_doc_path: path });
    return path;
  },

  // ---------- live updates ----------
  onJobs: (cb) => sb.channel('jobs')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, cb)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, cb)
    .subscribe(),
  offAll: () => sb.removeAllChannels(),

  // ---------- admin ----------
  admin: {
    stats: () => q(sb.rpc('admin_stats')),
    workers: () => q(sb.from('worker_profiles').select('*, profiles(full_name, phone, area, created_at)').limit(500)),
    docUrl: async (path) => (await q(sb.storage.from('id-docs').createSignedUrl(path, 300))).signedUrl,
    verify: (workerId, verified) => q(sb.rpc('verify_worker', { p_worker: workerId, p_verified: verified })),
    payouts: () => q(sb.rpc('admin_payouts')),
    markPayoutSent: (paymentId, ref) => q(sb.rpc('mark_payout_sent', { p_payment: paymentId, p_ref: ref })),
    feesOwed: () => q(sb.rpc('admin_fees_owed')),
    settleFees: (workerId, ref) => q(sb.rpc('settle_fees', { p_worker: workerId, p_ref: ref })),
    setRate: (service, daily, min) => q(sb.rpc('set_rate', { p_service: service, p_daily: daily, p_min: min })),
    disputes: () => q(sb.rpc('admin_disputes')),
    resolveDispute: (assignmentId, completed) => q(sb.rpc('resolve_dispute', { p_assignment: assignmentId, p_completed: completed })),
  },
};
