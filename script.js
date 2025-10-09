// Simple quiz logic
const toast = document.getElementById('toast');
const toastDot = document.getElementById('toast-dot');
const toastText = document.getElementById('toast-text');
let hideTimer = null;

function showToast(ok, msg){
  toast.classList.add('show');
  toastDot.className = 'dot ' + (ok ? 'good' : 'bad');
  toastText.textContent = msg;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(()=>toast.classList.remove('show'), 6000);
}

function markCard(card, ok){
  card.style.outline = '2px solid ' + (ok ? '#16a34a' : '#b91c1c');
  card.style.outlineOffset = '3px';
  setTimeout(()=>{ card.style.outline='none'; }, 6000);
}

document.querySelectorAll('.card').forEach(card=>{
  card.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-guess]');
    if(!btn) return;
    const guess = btn.getAttribute('data-guess');       // 'phish' | 'safe'
    const correct = card.getAttribute('data-correct');  // 'phish' | 'safe'
    const isCorrect = guess === correct;

    // Feedback messages
    let message = '';
    if(isCorrect){
      message = (guess === 'phish')
        ? 'Correct: Suspicious file type (double extension .pdf.exe).'
        : 'Correct: No immediate red flags in this message.';
    } else {
      message = (guess === 'phish')
        ? 'Not quite. This one looks routine; no obvious red flags.'
        : 'Careful! Double extension (.pdf.exe) is a classic malware trick.';
    }

    showToast(isCorrect, message);
    markCard(card, isCorrect);
  });
});