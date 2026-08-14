(function () {
  const talk = document.getElementById("talk");
  const compose = document.getElementById("compose");
  const brief = document.getElementById("brief");
  const files = document.getElementById("files");
  const thumbs = document.getElementById("thumbs");
  const send = document.getElementById("send");
  const preview = document.getElementById("preview");
  const frame = document.getElementById("product-frame");
  const desk = document.querySelector(".desk");

  const state = { job: null, pending: false, attachments: [] };

  function say(who, text) {
    const item = document.createElement("li");
    item.className = who === "you" ? "you" : "chief";
    const label = document.createElement("span");
    label.className = "who";
    label.textContent = who === "you" ? "You" : "Chief of staff";
    const body = document.createElement("p");
    body.textContent = text;
    item.append(label, body);
    talk.append(item);
    item.scrollIntoView({ block: "nearest" });
  }

  function showProduct(url) {
    if (!url) {
      preview.hidden = true;
      frame.removeAttribute("src");
      return;
    }
    frame.src = url;
    preview.hidden = false;
  }

  function renderThumbs() {
    thumbs.replaceChildren();
    if (!state.attachments.length) {
      thumbs.hidden = true;
      return;
    }
    thumbs.hidden = false;
    for (const file of state.attachments) {
      const img = document.createElement("img");
      img.alt = file.name || "screenshot";
      img.src = URL.createObjectURL(file);
      thumbs.append(img);
    }
  }

  function addFiles(list) {
    for (const file of list) {
      if (file && file.type && file.type.startsWith("image/")) {
        state.attachments.push(file);
      }
    }
    renderThumbs();
  }

  function setBusy(busy) {
    state.pending = busy;
    send.disabled = busy;
    desk.classList.toggle("busy", busy);
  }

  function operatorLine(job) {
    if (job.status === "failed") {
      return job.report || "That run failed. I kept the screenshot if you sent one.";
    }
    if (job.status === "running") {
      return "Building the tool.";
    }
    if (job.product_url) {
      return job.report || "The tool is ready.";
    }
    return job.report || "Working.";
  }

  async function sendTurn() {
    const text = brief.value.trim();
    if (!text && !state.attachments.length) {
      return;
    }
    if (!text) {
      say("chief", "Add a sentence with the screenshot so I know what to do.");
      return;
    }
    say("you", text);
    const data = new FormData();
    if (state.job && state.job.product_url) {
      data.append("instruction", text);
    } else {
      data.append("brief", text);
    }
    for (const file of state.attachments) {
      data.append("images", file, file.name || "paste.png");
    }
    brief.value = "";
    state.attachments = [];
    renderThumbs();
    setBusy(true);
    say("chief", state.job && state.job.product_url ? "Changing it." : "Building the tool.");
    try {
      const url = state.job && state.job.product_url
        ? "/api/jobs/" + state.job.id + "/steer"
        : "/api/jobs";
      const response = await fetch(url, { method: "POST", body: data });
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(payload.detail || response.statusText);
      }
      state.job = payload;
      talk.lastChild.remove();
      say("chief", operatorLine(payload));
      showProduct(payload.product_url);
    } catch (err) {
      talk.lastChild.remove();
      say("chief", String(err.message || err));
    } finally {
      setBusy(false);
      brief.focus();
    }
  }

  compose.addEventListener("submit", function (event) {
    event.preventDefault();
    sendTurn();
  });

  files.addEventListener("change", function () {
    addFiles(files.files);
    files.value = "";
  });

  document.addEventListener("paste", function (event) {
    if (!event.clipboardData) {
      return;
    }
    addFiles(event.clipboardData.files);
  });

  document.addEventListener("dragover", function (event) {
    event.preventDefault();
  });

  document.addEventListener("drop", function (event) {
    event.preventDefault();
    if (event.dataTransfer) {
      addFiles(event.dataTransfer.files);
    }
  });

  brief.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendTurn();
    }
  });
})();
