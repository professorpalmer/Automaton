(function () {
  const form = document.getElementById("inquiry");
  const send = document.getElementById("send");
  const note = document.getElementById("note");
  const hero = document.querySelector(".hero");
  const stage = document.querySelector(".field-stage");
  const bloom = document.querySelector(".field-bloom");
  const motionOk = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;

  function show(text, kind) {
    note.hidden = !text;
    note.textContent = text || "";
    if (kind) note.setAttribute("data-kind", kind);
    else note.removeAttribute("data-kind");
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    send.disabled = true;
    show("Sending.");
    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org: form.elements.org.value,
          name: form.elements.name.value,
          email: form.elements.email.value,
          note: form.elements.note.value,
        }),
      });
      const body = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        show(body.detail || "Could not send that.", "error");
        return;
      }
      form.reset();
      show("Received. We will stamp the box and send the link.");
    } catch {
      show("Could not send that.", "error");
    } finally {
      send.disabled = false;
    }
  });

  if (!motionOk || !hero || !stage || !bloom) return;

  let frame = 0;
  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;

  function tick() {
    x += (targetX - x) * 0.06;
    y += (targetY - y) * 0.06;
    stage.style.transform = "translate(" + x * 14 + "px, " + y * 10 + "px)";
    bloom.style.transform = "translate(" + x * 28 + "px, " + y * 18 + "px)";
    if (Math.abs(targetX - x) > 0.001 || Math.abs(targetY - y) > 0.001) {
      frame = window.requestAnimationFrame(tick);
    } else {
      frame = 0;
    }
  }

  function onMove(event) {
    const box = hero.getBoundingClientRect();
    targetX = (event.clientX - box.left) / box.width - 0.5;
    targetY = (event.clientY - box.top) / box.height - 0.5;
    if (!frame) frame = window.requestAnimationFrame(tick);
  }

  function onLeave() {
    targetX = 0;
    targetY = 0;
    if (!frame) frame = window.requestAnimationFrame(tick);
  }

  hero.addEventListener("pointermove", onMove);
  hero.addEventListener("pointerleave", onLeave);
  frame = window.requestAnimationFrame(tick);

  window.addEventListener("pagehide", function () {
    window.cancelAnimationFrame(frame);
    hero.removeEventListener("pointermove", onMove);
    hero.removeEventListener("pointerleave", onLeave);
  });
})();
