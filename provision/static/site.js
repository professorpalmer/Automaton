(function () {
  const form = document.getElementById("inquiry");
  const send = document.getElementById("send");
  const note = document.getElementById("note");

  function show(text) {
    note.hidden = !text;
    note.textContent = text || "";
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    send.disabled = true;
    show("");
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
        show(body.detail || "Could not send that.");
        return;
      }
      form.reset();
      show("Received. We will stamp the box and send the link.");
    } finally {
      send.disabled = false;
    }
  });
})();
