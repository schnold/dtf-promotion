(() => {
  const rail = document.querySelector('[data-site-scrollbar]');
  const thumb = document.querySelector('[data-site-scrollbar-thumb]');

  if (!(rail instanceof HTMLElement) || !(thumb instanceof HTMLElement)) return;

  let frame = 0;

  const update = () => {
    frame = 0;

    const root = document.documentElement;
    const viewportHeight = root.clientHeight;
    const pageHeight = root.scrollHeight;
    const scrollRange = pageHeight - viewportHeight;

    if (scrollRange <= 1) {
      rail.hidden = true;
      return;
    }

    rail.hidden = false;
    const railHeight = rail.clientHeight;
    const thumbHeight = Math.max(48, Math.min(railHeight, railHeight * (viewportHeight / pageHeight)));
    const progress = Math.min(1, Math.max(0, window.scrollY / scrollRange));
    const offset = (railHeight - thumbHeight) * progress;

    thumb.style.setProperty('--scroll-thumb-height', `${thumbHeight}px`);
    thumb.style.setProperty('--scroll-thumb-offset', `${offset}px`);
  };

  const requestUpdate = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  window.addEventListener('load', requestUpdate, { once: true });

  if ('ResizeObserver' in window) {
    new ResizeObserver(requestUpdate).observe(document.body);
  }

  requestUpdate();
})();
