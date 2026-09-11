/* Progressive enhancements only: canonical routing, catalog and basket remain in app.js. */
(() => {
  const main = document.getElementById('appMain');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function enhanceShelf() {
    const rail = main.querySelector('.featured-rail');
    if (!rail || rail.nextElementSibling?.classList.contains('shelf-controls')) return;
    const cards = [...rail.querySelectorAll('[data-featured-id]')];
    if (!cards.length) return;
    rail.setAttribute('aria-label', 'Top product picks');
    const controls = document.createElement('div');
    controls.className = 'shelf-controls';
    controls.innerHTML = '<span aria-live="polite"></span><button type="button" aria-label="Previous product">←</button><button type="button" aria-label="Next product">→</button>';
    rail.after(controls);
    const [previous, next] = controls.querySelectorAll('button');
    const status = controls.querySelector('span');
    const update = () => {
      const index = cards.reduce((best, card, i) => Math.abs(card.offsetLeft - cards[0].offsetLeft - rail.scrollLeft) < Math.abs(cards[best].offsetLeft - cards[0].offsetLeft - rail.scrollLeft) ? i : best, 0);
      status.textContent = `${index + 1} / ${cards.length} picks · swipe to explore`;
      previous.disabled = rail.scrollLeft < 5;
      next.disabled = rail.scrollWidth - rail.clientWidth - rail.scrollLeft < 5;
    };
    const move = direction => rail.scrollBy({ left: direction * (cards[0].getBoundingClientRect().width + 12), behavior: reduced() ? 'instant' : 'smooth' });
    previous.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    rail.addEventListener('scroll', update, { passive: true });
    requestAnimationFrame(update);
  }
  new MutationObserver(enhanceShelf).observe(main, { childList: true });
  enhanceShelf();
  for (const badge of document.querySelectorAll('.bottom-nav i')) {
    new MutationObserver(() => {
      badge.classList.remove('is-bumped');
      requestAnimationFrame(() => badge.classList.add('is-bumped'));
    }).observe(badge, { childList: true, characterData: true, subtree: true });
  }
})();
