const $ = (selector) => document.querySelector(selector);
const STORAGE_KEY = 'vocally-dashboard-concept-v1';
const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysAgo = (days) => { const date = new Date(); date.setDate(date.getDate() - days); return date; };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const safeUrl = (value) => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : 'http://localhost:5173'; } catch { return 'http://localhost:5173'; } };
function initialData() {
  return { name: 'Alex', practiceUrl: 'http://localhost:5173', challenges: {}, sessions: [
    ...[12, 18, 10, 22, 16].map((minutes, index) => ({ date: dayKey(daysAgo(5 - index)), minutes })),
    ...[9, 10, 11, 13, 14, 16].map(days => ({ date: dayKey(daysAgo(days)), minutes: 10 })),
  ] };
}
function readData() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || !Array.isArray(stored.sessions) || typeof stored.challenges !== 'object' || !stored.challenges) return initialData();
    return { name: typeof stored.name === 'string' && stored.name.trim() ? stored.name.slice(0, 28) : 'Alex', practiceUrl: safeUrl(stored.practiceUrl), challenges: stored.challenges,
      sessions: stored.sessions.filter(session => /^\d{4}-\d{2}-\d{2}$/.test(session.date) && Number.isFinite(session.minutes) && session.minutes > 0 && session.minutes <= 180) };
  } catch { return initialData(); }
}
let data = readData();
let activeCard = null;
let toastTimer;
const challenges = [
  { title: 'Make space for a breath', description: 'Take five slow, comfortable breaths before speaking. There is no rush.', duration: '2 min' },
  { title: 'Tell a little story', description: 'Share a small moment from your day, out loud, in your own words.', duration: '3 min' },
  { title: 'A moment to reflect', description: 'Name one thing you felt good about while speaking today.', duration: '1 min' },
];
const checked = () => Array.isArray(data.challenges[dayKey()]) ? data.challenges[dayKey()].filter(value => [0, 1, 2].includes(value)) : [];
const activeDates = () => new Set([...data.sessions.map(session => session.date), ...Object.keys(data.challenges).filter(date => Array.isArray(data.challenges[date]) && data.challenges[date].length > 0)]);
function streak() {
  const dates = activeDates(); let length = 0; let offset = dates.has(dayKey()) ? 0 : 1;
  while (dates.has(dayKey(daysAgo(offset)))) { length++; offset++; }
  return length;
}
const weekData = () => Array.from({length: 7}, (_, index) => { const date = daysAgo(6 - index); return { key: dayKey(date), label: date.toLocaleDateString('en-US', {weekday: 'short'}), minutes: data.sessions.filter(session => session.date === dayKey(date)).reduce((total, session) => total + session.minutes, 0) }; });
const totalMinutes = () => weekData().reduce((total, day) => total + day.minutes, 0);
const badges = () => [
  { icon: '✧', title: 'The first hello', description: 'Your first practice session. A small beginning with a big possibility.', unlocked: data.sessions.length > 0, progress: `${Math.min(data.sessions.length, 1)} / 1 session` },
  { icon: '❋', title: 'Finding your rhythm', description: 'Make time for ten practice sessions, each at your own pace.', unlocked: data.sessions.length >= 10, progress: `${Math.min(data.sessions.length, 10)} / 10 sessions` },
  { icon: '☀', title: 'A week of showing up', description: 'Practice or complete a challenge on seven consecutive days.', unlocked: streak() >= 7, progress: `${Math.min(streak(), 7)} / 7 days` },
];
function notify(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200); }
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { notify('Browser storage is unavailable. Changes last for this visit.'); } }
function weekMarkup(large = false) {
  const dates = activeDates();
  return `<div class="week ${large ? 'detail-week' : ''}">${weekData().map(day => `<span class="day"><span>${day.label.slice(0, large ? 3 : 1)}</span><i class="${dates.has(day.key) ? 'active' : ''} ${day.key === dayKey() ? 'current' : ''}" aria-label="${day.label}: ${dates.has(day.key) ? 'activity complete' : 'no activity'}">${dates.has(day.key) ? '✓' : '·'}</i></span>`).join('')}</div>`;
}
function card(id, number, label, symbol, body, footer) {
  return `<button type="button" class="card" data-card="${id}" aria-label="Open ${label}" aria-haspopup="dialog"><span class="card-top"><span>${number} / ${label.toUpperCase()}</span><span class="card-symbol" aria-hidden="true">${symbol}</span></span>${body}<span class="card-bottom"><span>${footer}</span><span class="arrow" aria-hidden="true">↗</span></span></button>`;
}
function renderDashboard() {
  $('#user-name').textContent = data.name;
  $('#practice-link').href = data.practiceUrl;
  $('#today').textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  const done = checked(); const unlocked = badges().filter(badge => badge.unlocked).length;
  const week = weekData(); const max = Math.max(25, ...week.map(day => day.minutes));
  $('#cards').innerHTML = [
    card('challenges', '01', 'Daily challenges', '↗', `<h3>Small steps,<br>stronger voice.</h3><ul class="mini-tasks">${challenges.map((challenge, index) => `<li class="${done.includes(index) ? 'completed' : ''}"><span class="check ${done.includes(index) ? 'done' : ''}">${done.includes(index) ? '✓' : ''}</span>${challenge.title}</li>`).join('')}</ul>`, `${done.length} of 3 little wins today`),
    card('achievements', '02', 'Achievements', '✧', `<h3>Look at you grow.</h3><p class="card-description">Every milestone tells your story.</p><div class="medals" aria-hidden="true">${badges().map(badge => `<span class="medal ${badge.unlocked ? '' : 'locked'}">${badge.icon}</span>`).join('')}</div>`, `${unlocked} milestones unlocked`),
    card('progress', '03', 'Practice time', '◷', `<div class="metric">${totalMinutes()}<small>min this week</small></div><p class="card-description">Time well spent on yourself.</p><div class="mini-chart" aria-hidden="true">${week.map(day => `<span class="mini-bar" style="height:${Math.max(6, day.minutes / max * 100)}%"></span>`).join('')}</div>`, 'Your last 7 days'),
    card('streak', '04', 'Your streak', '☀', `<div class="metric">${streak()}<small>days in a row</small></div><p class="card-description">A little consistency. A lot of possibility.</p>${weekMarkup()}`, activeDates().has(dayKey()) ? 'You showed up for yourself today' : 'Let’s make today count'),
  ].join('');
}
const heading = (category, title, description) => `<div class="detail-heading"><div class="eyebrow"><span class="live-dot"></span>${category}</div><h2 id="detail-title">${title}</h2><p>${description}</p></div>`;
function renderDetail() {
  const done = checked(); let content = '';
  if (activeCard === 'challenges') content = heading('01 / DAILY CHALLENGES', 'Small steps. Your kind of progress.', 'Three gentle invitations to use your voice today. Choose what feels right, and check it off when you’re ready.') + `<div class="detail-grid"><div class="panel">${challenges.map((challenge, index) => `<div class="challenge-row"><input type="checkbox" id="challenge-${index}" data-challenge="${index}" ${done.includes(index) ? 'checked' : ''}><label for="challenge-${index}"><strong>${challenge.title}</strong><small>${challenge.description}</small></label><span class="pill">${challenge.duration}</span></div>`).join('')}</div><aside class="panel"><h3>Your little wins</h3><div class="big-number">${done.length}<small> / 3 today</small></div><div class="progress-track" role="progressbar" aria-label="Daily challenges completed" aria-valuenow="${done.length}" aria-valuemin="0" aria-valuemax="3"><span style="width:${done.length / 3 * 100}%"></span></div><p>${done.length === 3 ? 'You made space for your voice today. Take a moment to enjoy that.' : 'There’s no perfect way to begin. One small step is enough.'}</p><a class="primary" href="${escapeHtml(data.practiceUrl)}">Practice with Vocally ↗</a></aside></div>`;
  if (activeCard === 'achievements') content = heading('02 / ACHIEVEMENTS', 'You’re building something lovely.', 'A collection of small beginnings and meaningful moments. Each milestone grows from your practice activity.') + `<div class="badge-grid">${badges().map(badge => `<article class="badge-panel"><div class="medal ${badge.unlocked ? '' : 'locked'}" aria-hidden="true">${badge.icon}</div><h3>${badge.title}</h3><p>${badge.description}</p><span class="pill">${badge.unlocked ? '✓ Unlocked' : badge.progress}</span></article>`).join('')}</div><p class="note">Milestones reflect this demo profile’s saved activity. The seven-day milestone follows your current streak.</p>`;
  if (activeCard === 'progress') {
    const week = weekData(); const max = Math.max(25, ...week.map(day => day.minutes));
    content = heading('03 / PRACTICE TIME', 'Time for you. Room to grow.', 'Every minute is a moment you chose to show up for yourself. Here’s your practice over the last seven days.') + `<div class="detail-grid"><section class="panel"><h3>${totalMinutes()} minutes of possibility</h3><div class="chart" role="img" aria-label="Practice minutes: ${week.map(day => `${day.label} ${day.minutes}`).join(', ')}">${week.map(day => `<div class="chart-column"><strong>${day.minutes}m</strong><div class="bar" style="height:${Math.max(2, day.minutes / max * 175)}px"></div><span>${day.label}</span></div>`).join('')}</div></section><aside class="panel"><h3>Add a practice moment</h3><p>Practiced on your own? Record those minutes here.</p><form id="session-form"><label for="minutes" class="note">Minutes practiced today</label><input id="minutes" name="minutes" type="number" min="1" max="180" step="1" value="5" required style="display:block;width:100%;padding:12px;margin:12px 0 20px;border:1px solid #cbd0bf;border-radius:8px;background:#fafbf4;font:inherit"><button class="primary" type="submit">Save practice ↗</button></form><p class="note">Manual entries stay in this concept. Live Vocally sessions are not connected yet.</p></aside></div><section class="panel" style="margin-top:25px"><h3>Recent practice</h3><ul class="session-list">${[...data.sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map(session => `<li><span>${new Date(`${session.date}T12:00:00`).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}</span><span>${session.minutes} minutes</span></li>`).join('')}</ul></section>`;
  }
  if (activeCard === 'streak') content = heading('04 / YOUR STREAK', 'Keep showing up as you.', 'Consistency can be gentle. A practice session or one daily challenge is all it takes to make today part of your story.') + `<div class="detail-grid"><section class="panel"><div class="big-number">${streak()}<small> days in a row</small></div>${weekMarkup(true)}<p>${activeDates().has(dayKey()) ? 'Today is already part of your story. Beautifully done.' : 'Your next little moment is waiting. Complete a challenge or record your practice to include today.'}</p></section><aside class="panel"><h3>A rhythm, not a race.</h3><p>Miss a day? You can always begin again. Your practice history and the work you’ve put in are still here.</p><button class="primary" data-switch="challenges">Find a little challenge ↗</button><p class="note">Days follow your local time. Today or yesterday can anchor your current streak.</p></aside></div>`;
  $('#detail-content').innerHTML = content;
}
function openCard(id) {
  activeCard = id; renderDetail();
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-dialog').scrollTop = 0;
  $('#close-detail').focus();
}
$('#cards').addEventListener('click', event => { const card = event.target.closest('[data-card]'); if (card) openCard(card.dataset.card); });
$('#close-detail').addEventListener('click', () => $('#detail-dialog').close());
$('#detail-dialog').addEventListener('close', () => { document.querySelector(`[data-card="${activeCard}"]`)?.focus(); });
$('#detail-content').addEventListener('click', event => { const button = event.target.closest('[data-switch]'); if (button) openCard(button.dataset.switch); });
$('#detail-content').addEventListener('change', event => {
  const target = event.target; if (!target.matches('[data-challenge]')) return;
  const index = Number(target.dataset.challenge); const next = new Set(checked());
  target.checked ? next.add(index) : next.delete(index);
  data.challenges[dayKey()] = [...next]; save(); renderDashboard(); renderDetail();
  $(`#challenge-${index}`).focus();
  if (target.checked) notify(next.size === 3 ? 'Three little wins. A lovely day of progress.' : 'One small step, just for you.');
});
$('#detail-content').addEventListener('submit', event => {
  if (event.target.id !== 'session-form') return;
  event.preventDefault(); const minutes = Number(new FormData(event.target).get('minutes'));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) return;
  data.sessions.push({date: dayKey(), minutes}); save(); renderDashboard(); renderDetail();
  $('#minutes').focus(); notify(`${minutes} minutes added. Your time counts.`);
});
function openProfile() { $('#name-input').value = data.name; $('#practice-input').value = data.practiceUrl; $('#profile-dialog').showModal(); }
$('#edit-name').addEventListener('click', openProfile);
$('#edit-profile').addEventListener('click', openProfile);
$('#cancel-profile').addEventListener('click', () => $('#profile-dialog').close());
$('#profile-form').addEventListener('submit', event => {
  event.preventDefault(); const name = $('#name-input').value.trim(); const url = $('#practice-input');
  if (!name) { $('#name-input').setCustomValidity('Please enter your first name.'); $('#name-input').reportValidity(); return; }
  if (!/^https?:\/\//i.test(url.value)) { url.setCustomValidity('Use an http:// or https:// address.'); url.reportValidity(); return; }
  data.name = name; data.practiceUrl = safeUrl(url.value); save(); renderDashboard(); $('#profile-dialog').close(); notify('Your space, a little more you.');
});
$('#name-input').addEventListener('input', event => event.target.setCustomValidity(''));
$('#practice-input').addEventListener('input', event => event.target.setCustomValidity(''));
let renderedDay = dayKey();
setInterval(() => { if (renderedDay !== dayKey()) { renderedDay = dayKey(); renderDashboard(); if ($('#detail-dialog').open) renderDetail(); } }, 30000);
renderDashboard();
