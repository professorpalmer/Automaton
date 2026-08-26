(function () {
  const boxes = document.getElementById("boxes");
  const empty = document.getElementById("empty");
  const inquiries = document.getElementById("inquiries");
  const inquiryEmpty = document.getElementById("inquiry-empty");
  const form = document.getElementById("stamp");
  const send = document.getElementById("send");
  const note = document.getElementById("note");

  function headers() {
    const token = (form.elements.host_token.value || "").trim();
    const out = { "Content-Type": "application/json" };
    if (token) {
      out.Authorization = "Bearer " + token;
    }
    return out;
  }

  function show(text) {
    note.hidden = !text;
    note.textContent = text || "";
  }

  function drawBoxes(rows) {
    boxes.replaceChildren();
    empty.hidden = rows.length > 0;
    for (const box of rows) {
      const item = document.createElement("li");
      const org = document.createElement("span");
      org.className = "org";
      org.textContent = box.display || box.slug;
      item.append(org);
      if (box.url) {
        const link = document.createElement("a");
        link.href = box.url;
        link.textContent = box.url;
        item.append(link);
      } else {
        const wait = document.createElement("span");
        wait.textContent = box.ask || box.need || box.status || "not live";
        item.append(wait);
      }
      boxes.append(item);
    }
  }

  function drawInquiries(rows) {
    inquiries.replaceChildren();
    inquiryEmpty.hidden = rows.length > 0;
    for (const row of rows) {
      const item = document.createElement("li");
      const org = document.createElement("span");
      org.className = "org";
      org.textContent = row.org;
      const meta = document.createElement("span");
      meta.textContent = row.name + " · " + row.email;
      item.append(org, meta);
      if (row.note) {
        const noteLine = document.createElement("span");
        noteLine.textContent = row.note;
        item.append(noteLine);
      }
      inquiries.append(item);
    }
  }

  async function refresh() {
    const listed = await fetch("/api/boxes", { headers: headers() });
    if (!listed.ok) {
      show(listed.status === 401 ? "Host token required." : "Could not list boxes.");
      return;
    }
    drawBoxes((await listed.json()).boxes || []);
    const inbox = await fetch("/api/inquiries", { headers: headers() });
    if (inbox.ok) {
      drawInquiries((await inbox.json()).inquiries || []);
    }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    send.disabled = true;
    show("");
    const payload = {
      slug: form.elements.slug.value,
      display: form.elements.display.value,
      render_api_key: form.elements.render_api_key.value,
      openrouter_api_key: form.elements.openrouter_api_key.value,
      github_token: form.elements.github_token.value,
    };
    try {
      const response = await fetch("/api/boxes", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        show(body.detail || "Stamp failed.");
        return;
      }
      form.elements.render_api_key.value = "";
      form.elements.openrouter_api_key.value = "";
      form.elements.github_token.value = "";
      show(body.url ? "Live at " + body.url : body.ask || "Stamped.");
      await refresh();
    } finally {
      send.disabled = false;
    }
  });

  refresh();
})();
