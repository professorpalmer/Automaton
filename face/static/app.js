(function () {
  const talk = document.getElementById("talk");
  const anchor = document.getElementById("talk-anchor");
  const compose = document.getElementById("compose");
  const brief = document.getElementById("brief");
  const files = document.getElementById("files");
  const thumbs = document.getElementById("thumbs");
  const send = document.getElementById("send");
  const preview = document.getElementById("preview");
  const frame = document.getElementById("product-frame");
  const undo = document.getElementById("undo");
  const hint = document.getElementById("send-hint");
  const desk = document.querySelector(".desk");
  const onMac = /Mac|iPhone|iPad/.test(navigator.platform || "");

  const state = { job: null, pending: false, attachments: [], watch: null, spoken: [] };

  function syncViewport() {
    const port = window.visualViewport;
    const height = port ? port.height : window.innerHeight;
    document.documentElement.style.setProperty("--vvh", height + "px");
  }

  function followingTalk() {
    const slack = 48;
    return talk.scrollHeight - talk.scrollTop - talk.clientHeight < slack;
  }

  function pinTalk(follow) {
    if (follow) {
      talk.scrollTop = talk.scrollHeight;
    }
  }

  function say(who, text) {
    const follow = followingTalk();
    const item = document.createElement("li");
    item.className = who === "you" ? "you" : "chief";
    const label = document.createElement("span");
    label.className = "who";
    label.textContent = who === "you" ? "You" : "Chief of staff";
    const body = document.createElement("p");
    body.textContent = text;
    item.append(label, body);
    talk.insertBefore(item, anchor);
    pinTalk(follow);
    return item;
  }

  function showProduct(url) {
    if (!url) {
      preview.hidden = true;
      frame.removeAttribute("src");
      undo.hidden = true;
      return;
    }
    frame.src = url + (url.indexOf("?") === -1 ? "?" : "&") + "v=" + Date.now();
    preview.hidden = false;
  }

  function syncRewind(job) {
    const allowed = !!(job && job.can_undo);
    undo.hidden = !allowed;
    if (!hint) {
      return;
    }
    const sendLabel = onMac ? "Send Cmd+Enter" : "Send Ctrl+Enter";
    hint.textContent = allowed
      ? sendLabel + (onMac ? " · Undo Cmd+Z" : " · Undo Ctrl+Z")
      : sendLabel + " · Esc clears files";
  }

  function isImage(file) {
    return !!(file && file.type && file.type.startsWith("image/"));
  }

  function allowedFile(file) {
    if (!file) {
      return false;
    }
    if (isImage(file)) {
      return true;
    }
    return /\.(xlsx|xlsm|xls|csv|pdf|docx|png|jpe?g|webp|gif)$/i.test(file.name || "");
  }

  function renderThumbs() {
    thumbs.replaceChildren();
    if (!state.attachments.length) {
      thumbs.hidden = true;
      return;
    }
    thumbs.hidden = false;
    for (const file of state.attachments) {
      if (isImage(file)) {
        const img = document.createElement("img");
        img.alt = file.name || "screenshot";
        img.src = URL.createObjectURL(file);
        thumbs.append(img);
      } else {
        const chip = document.createElement("span");
        chip.className = "file-chip";
        chip.textContent = file.name || "file";
        thumbs.append(chip);
      }
    }
  }

  function addFiles(list) {
    let refused = 0;
    for (const file of list) {
      if (allowedFile(file)) {
        state.attachments.push(file);
      } else {
        refused += 1;
      }
    }
    renderThumbs();
    if (refused) {
      say("chief", "I can take a spreadsheet, PDF, or screenshot — not that file type.");
    }
  }

  function setBusy(busy) {
    state.pending = busy;
    send.disabled = busy;
    desk.classList.toggle("busy", busy);
  }

  function operatorLine(job) {
    if (job.status === "failed") {
      return job.report || "That run failed. I kept the file if you sent one.";
    }
    if (job.status === "intake" || job.waiting) {
      return job.report || "I need a file before we can finish.";
    }
    if (job.status === "running") {
      return job.report || "I've got someone working on that.";
    }
    if (job.product_url || job.live_url) {
      return job.report || "The team is finished with your project.";
    }
    return job.report || "Working.";
  }

  function hasNonImage() {
    return state.attachments.some(function (file) {
      return !isImage(file);
    });
  }

  function turnKind() {
    if (state.job && state.job.building) {
      return "intake";
    }
    if (state.job && state.job.waiting && !state.job.product_url) {
      return "intake";
    }
    if (state.job && state.job.product_url) {
      if (hasNonImage() || (state.job.waiting && saidGo(brief.value))) {
        return "intake";
      }
      return "steer";
    }
    if (state.job && state.job.waiting) {
      return "intake";
    }
    return "open";
  }

  function speakJob(payload, ack) {
    if (state.spokenFor !== payload.id) {
      state.spoken = [];
      state.spokenFor = payload.id;
    }
    const parts = payload.bubbles && payload.bubbles.length
      ? payload.bubbles
      : [operatorLine(payload)];
    for (let i = 0; i < parts.length; i += 1) {
      if (
        parts[i] === ack
        || parts[i] === "Building the tool from that brief."
        || parts[i] === "I've got someone working on that."
        || parts[i] === "I've got a team working on your request."
        || state.spoken.indexOf(parts[i]) !== -1
      ) {
        continue;
      }
      state.spoken.push(parts[i]);
      say("chief", parts[i]);
    }
    showProduct(payload.product_url);
    syncRewind(payload);
  }

  function watchBuild(id, ack) {
    if (state.watch === id) {
      return;
    }
    state.watch = id;
    const tick = function () {
      if (!state.job || state.job.id !== id) {
        return;
      }
      fetch("/api/jobs/" + id)
        .then(function (response) { return response.json(); })
        .then(function (payload) {
          state.job = payload;
          if (payload.building) {
            setTimeout(tick, 700);
            return;
          }
          state.watch = null;
          speakJob(payload, ack);
        })
        .catch(function () {
          setTimeout(tick, 1200);
        });
    };
    setTimeout(tick, 700);
  }

  function saidGo(text) {
    return /\b(go ahead|that's all|that is all|build it|just build|start anyway|i don't have|i do not have|no file|no workbook|skip)\b/i.test(
      text || "",
    );
  }

  async function sendTurn() {
    const text = brief.value.trim();
    const kind = turnKind();
    if (!text && !state.attachments.length) {
      return;
    }
    if (kind === "open" && !text) {
      say("chief", "Add a sentence so I know what to build.");
      return;
    }
    if (kind === "steer" && !text) {
      if (!state.attachments.some(isImage)) {
        say("chief", "Add a sentence with the screenshot so I know what to do.");
        return;
      }
      text = "Change the tool to match this screenshot.";
    }
    say("you", text || state.attachments.map(function (file) { return file.name; }).join(", "));
    const data = new FormData();
    let url;
    let ack = "";
    if (kind === "steer") {
      data.append("instruction", text);
      url = "/api/jobs/" + state.job.id + "/steer";
      ack = "Changing the tool from that note.";
    } else if (kind === "intake") {
      if (text) {
        data.append("note", text);
      }
      url = "/api/jobs/" + state.job.id + "/continue";
      ack = saidGo(text) ? "I've got a team working on your request." : "Got that.";
    } else {
      data.append("brief", text);
      url = "/api/jobs";
      ack = /remember|come back to|ideas to update/i.test(text)
        ? "Let me pull that up."
        : "I've got someone working on that.";
    }
    for (const file of state.attachments) {
      data.append(kind === "steer" ? "images" : "files", file, file.name || "upload.bin");
    }
    brief.value = "";
    state.attachments = [];
    renderThumbs();
    setBusy(true);
    say("chief", ack);
    try {
      const response = await fetch(url, { method: "POST", body: data });
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(payload.detail || response.statusText);
      }
      state.job = payload;
      speakJob(payload, ack);
      if (payload.building) {
        watchBuild(payload.id, ack);
      }
    } catch (err) {
      say("chief", String(err.message || err));
    } finally {
      setBusy(false);
      brief.focus();
    }
  }

  async function undoTurn() {
    if (!state.job || !state.job.can_undo || state.pending) {
      return;
    }
    say("you", "Undo");
    setBusy(true);
    try {
      const response = await fetch("/api/jobs/" + state.job.id + "/undo", { method: "POST" });
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(payload.detail || response.statusText);
      }
      state.job = payload;
      const parts = payload.bubbles && payload.bubbles.length
        ? payload.bubbles
        : ["Put it back."];
      for (let i = 0; i < parts.length; i += 1) {
        say("chief", parts[i]);
      }
      showProduct(payload.product_url);
      syncRewind(payload);
    } catch (err) {
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

  undo.addEventListener("click", function () {
    undoTurn();
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

  fetch("/api/status")
    .then(function (response) { return response.json(); })
    .then(function (status) {
      if (status && status.screenshot_readable === false) {
        say(
          "chief",
          "I can build a tool from a sentence and recolor it after. Screenshots are kept, but I cannot read them until the org OpenRouter key is in the vault."
        );
      }
    })
    .catch(function () { /* status is best-effort */ });

  brief.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendTurn();
    }
  });

  document.addEventListener("keydown", function (event) {
    const inComposer = document.activeElement === brief;
    if (event.key === "Escape" && state.attachments.length) {
      state.attachments = [];
      renderThumbs();
    }
    if (event.key === "/" && !inComposer && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      brief.focus();
    }
    if (inComposer && (event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
      event.stopPropagation();
    }
    if (!inComposer && (event.key === "z" || event.key === "Z") && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      if (state.job && state.job.can_undo) {
        event.preventDefault();
        undoTurn();
      }
    }
  });

  if (hint && !onMac) {
    hint.textContent = "Send Ctrl+Enter · Esc clears files";
  }

  syncViewport();
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewport);
    window.visualViewport.addEventListener("scroll", syncViewport);
  }
  window.addEventListener("resize", syncViewport);
})();
