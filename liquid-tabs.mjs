// One continuous lens, shared by all tabs. Only its transform changes during
// motion; the text and tap targets stay in place for reliable touch/keyboard use.
export function createLiquidTabs(tablist, { onSelect }) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const lens = tablist.querySelector(".tab-lens");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let selected = Math.max(0, tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true"));
  let boxes = [];
  let position = 0;
  let target = 0;
  let velocity = 0;
  let pressure = 0;
  let pressed = false;
  let frame = 0;
  let lastTime = 0;
  let gesture = null;
  let suppressClick = false;

  function paint() {
    const box = boxes[selected];
    if (!box) return;
    const stretch = reducedMotion.matches ? 0 : Math.min(.22,
      Math.abs(velocity) / 5500 + Math.abs(target - position) / box.width * .055);
    const scaleX = 1 + stretch + pressure * .035;
    const scaleY = 1 - stretch * .32 + pressure * .045;
    const half = box.width * scaleX / 2;
    const center = clamp(position, 3 + half, tablist.clientWidth - 3 - half);
    lens.style.transform = `translate3d(${center - box.width / 2}px, ${box.top}px, 0) scale(${scaleX}, ${scaleY})`;
    lens.style.setProperty("--lens-pressure", pressure.toFixed(3));
  }

  function tick(time) {
    const elapsed = lastTime ? Math.min((time - lastTime) / 1000, .032) : 1 / 60;
    lastTime = time;
    // A damped spring gives the lens a small elastic landing. Direct dragging
    // uses a tighter spring so the material stays underneath the finger.
    const stiffness = gesture?.dragging ? 900 : 520;
    const damping = gesture?.dragging ? 48 : 34;
    velocity += ((target - position) * stiffness - velocity * damping) * elapsed;
    position += velocity * elapsed;
    pressure += ((pressed ? 1 : 0) - pressure) * (1 - Math.exp(-elapsed * 18));
    const moving = Math.abs(target - position) > .06 || Math.abs(velocity) > .4 || Math.abs(pressure - (pressed ? 1 : 0)) > .005;
    if (!moving) { position = target; velocity = 0; pressure = pressed ? 1 : 0; }
    paint();
    frame = moving ? requestAnimationFrame(tick) : 0;
    if (!moving) lastTime = 0;
  }

  function move(instant = false) {
    if (instant || reducedMotion.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      position = target;
      velocity = 0;
      pressure = 0;
      paint();
    } else if (!frame) frame = requestAnimationFrame(tick);
  }

  function measure() {
    if (gesture) cancelGesture();
    const bounds = tablist.getBoundingClientRect();
    boxes = tabs.map(tab => {
      const rect = tab.getBoundingClientRect();
      return {
        center: rect.left - bounds.left - tablist.clientLeft + rect.width / 2,
        top: rect.top - bounds.top - tablist.clientTop,
        width: rect.width, height: rect.height
      };
    });
    const box = boxes[selected];
    lens.style.width = box.width + "px";
    lens.style.height = box.height + "px";
    target = box.center;
    move(true);
    tablist.dataset.liquidReady = "";
  }

  function preview(index = -1) {
    tabs.forEach((tab, i) => tab.toggleAttribute("data-preview", i === index));
  }

  function select(tab, { instant = false } = {}) {
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    selected = index;
    preview();
    target = boxes[index]?.center ?? 0;
    move(instant);
  }

  function light(clientX) {
    const rect = tablist.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    tablist.style.setProperty("--glass-light-x", (x / rect.width * 100).toFixed(1) + "%");
    const width = boxes[selected]?.width ?? 1;
    lens.style.setProperty("--lens-light-x", clamp((x - position + width / 2) / width * 100, 12, 88).toFixed(1) + "%");
  }

  function cancelGesture() {
    const previous = gesture;
    gesture = null;
    pressed = false;
    delete tablist.dataset.interacting;
    preview();
    target = boxes[selected]?.center ?? 0;
    move();
    if (previous && tablist.hasPointerCapture?.(previous.id)) tablist.releasePointerCapture(previous.id);
  }

  function nearest(center) {
    return boxes.reduce((best, box, index) => Math.abs(box.center - center) < Math.abs(boxes[best].center - center) ? index : best, 0);
  }

  tablist.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const tab = event.target.closest?.('[role="tab"]');
    if (!tabs.includes(tab)) return;
    suppressClick = false;
    const index = tabs.indexOf(tab);
    const rect = tablist.getBoundingClientRect();
    gesture = {
      id: event.pointerId, startX: event.clientX, startY: event.clientY,
      offset: event.clientX - rect.left - tablist.clientLeft - boxes[index].center,
      dragging: false
    };
    pressed = true;
    tablist.dataset.interacting = "";
    preview(index);
    target = boxes[index].center;
    light(event.clientX);
    move();
  });

  tablist.addEventListener("pointermove", event => {
    light(event.clientX);
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.dragging) {
      if (Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)) { cancelGesture(); return; }
      if (Math.abs(dx) < 6) return;
      gesture.dragging = true;
      tablist.setPointerCapture(event.pointerId);
    }
    const rect = tablist.getBoundingClientRect();
    target = clamp(event.clientX - rect.left - tablist.clientLeft - gesture.offset, boxes[0].center, boxes.at(-1).center);
    preview(nearest(target));
    move();
  });

  window.addEventListener("pointerup", event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const index = nearest(target);
    const rect = tablist.getBoundingClientRect();
    const commit = gesture.dragging && event.clientY >= rect.top - 40 && event.clientY <= rect.bottom + 40;
    suppressClick = gesture.dragging;
    cancelGesture();
    if (commit) onSelect(tabs[index]);
  });
  window.addEventListener("pointercancel", event => {
    if (gesture?.id === event.pointerId) cancelGesture();
  });
  tablist.addEventListener("lostpointercapture", event => {
    // Touch starts with implicit capture on the button. Its bubbling loss when
    // capture moves to the bar is part of the drag, rather than a cancellation.
    if (event.target === tablist && gesture?.id === event.pointerId) cancelGesture();
  });
  tablist.addEventListener("pointerleave", () => {
    if (!gesture) {
      tablist.style.removeProperty("--glass-light-x");
      lens.style.removeProperty("--lens-light-x");
    }
  });
  tablist.addEventListener("click", event => {
    if (suppressClick && event.detail !== 0) {
      suppressClick = false;
      event.preventDefault();
      return;
    }
    const tab = event.target.closest?.('[role="tab"]');
    if (tabs.includes(tab)) onSelect(tab);
  });
  reducedMotion.addEventListener("change", () => move(true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelGesture(); move(true); }
  });
  if (window.ResizeObserver) new ResizeObserver(measure).observe(tablist);
  else window.addEventListener("resize", measure);
  measure();
  return { select, get reducedMotion() { return reducedMotion.matches; } };
}
