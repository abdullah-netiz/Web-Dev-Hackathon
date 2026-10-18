/**
 * Public lead capture form (F3.1). Served at GET /f/:slug, posts to POST /intake/:slug.
 * Responsive (Q7) and accessible: labelled inputs, visible focus, status by text not colour (Q8).
 */
export function renderIntakeForm(input: { slug: string; workspaceName: string; apiBase: string }): string {
  const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contact ${esc(input.workspaceName)}</title>
<style>
  :root { color-scheme: light dark; --fg:#111827; --bg:#ffffff; --muted:#4b5563; --border:#d1d5db; --accent:#1d4ed8; --ok:#065f46; --err:#991b1b; }
  @media (prefers-color-scheme: dark) { :root { --fg:#f3f4f6; --bg:#111827; --muted:#9ca3af; --border:#374151; --accent:#60a5fa; --ok:#6ee7b7; --err:#fca5a5; } }
  * { box-sizing: border-box; }
  body { margin:0; font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width: 520px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; } p.lead { color: var(--muted); margin: 0 0 24px; }
  label { display:block; font-weight:600; margin: 16px 0 6px; }
  input, textarea { width:100%; font: inherit; padding: 10px 12px; border:1px solid var(--border); border-radius:8px; background:transparent; color:inherit; }
  input:focus-visible, textarea:focus-visible, button:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  button { margin-top: 20px; width:100%; padding: 12px; font: inherit; font-weight:600; border:0; border-radius:8px; background:var(--accent); color:#fff; cursor:pointer; }
  button[disabled] { opacity:.6; cursor:progress; }
  .hint { color: var(--muted); font-size:.9rem; margin-top:4px; }
  [role=status] { margin-top:16px; padding:12px; border-radius:8px; border:1px solid var(--border); }
  .ok { color: var(--ok); } .err { color: var(--err); }
</style>
</head>
<body>
<main>
  <h1>Contact ${esc(input.workspaceName)}</h1>
  <p class="lead">Leave your details and a team member will get back to you shortly.</p>
  <form id="f" novalidate>
    <label for="firstName">First name <span aria-hidden="true">*</span></label>
    <input id="firstName" name="firstName" required autocomplete="given-name" maxlength="60">
    <label for="lastName">Last name</label>
    <input id="lastName" name="lastName" autocomplete="family-name" maxlength="60">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" inputmode="email">
    <label for="phone">Phone (international format)</label>
    <input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+14155551234">
    <div class="hint">Give an email or a phone number so we can reach you.</div>
    <label for="message">How can we help? <span aria-hidden="true">*</span></label>
    <textarea id="message" name="message" rows="4" required maxlength="2000"></textarea>
    <button type="submit" id="submit">Send</button>
    <div id="status" role="status" aria-live="polite" hidden></div>
  </form>
</main>
<script>
(function () {
  var form = document.getElementById('f'), status = document.getElementById('status'), button = document.getElementById('submit');
  function show(text, cls) { status.hidden = false; status.className = cls; status.textContent = text; }
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(form).entries());
    if (!data.firstName.trim() || !data.message.trim()) { show('Please fill in your first name and message.', 'err'); return; }
    if (!data.email && !data.phone) { show('Please give an email or a phone number.', 'err'); return; }
    button.disabled = true; show('Sending…', '');
    try {
      var res = await fetch(${JSON.stringify(input.apiBase)} + '/intake/' + ${JSON.stringify(input.slug)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      var body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Something went wrong');
      show('Thanks! Your request #' + body.data.reference + ' was received. Someone will contact you soon.', 'ok');
      form.reset();
    } catch (error) {
      show('We could not send your request: ' + error.message + ' Please try again.', 'err');
    } finally { button.disabled = false; }
  });
})();
</script>
</body>
</html>`;
}
