import {
  TOOLS,
  DEMO_PROMPTS,
  PATIENT,
  demoAgentReply,
} from "./demo-data.js";

const PO_BASE = "https://app.promptopinion.ai";
const FHIR_CONTEXT_URI = `${PO_BASE}/schemas/a2a/v1/fhir-context`;

const state = {
  selectedTool: null,
};

function $(id) {
  return document.getElementById(id);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */

function initTabs() {
  const tabs = document.querySelectorAll(".mode-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const panel = tab.dataset.panel;
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      document.querySelectorAll(".panel").forEach((p) => {
        const on = p.id === `panel-${panel}`;
        p.classList.toggle("is-active", on);
        p.hidden = !on;
      });
    });
  });
}

/* ── MCP Inspector ────────────────────────────────────────────────────── */

function renderToolList() {
  const list = $("tool-list");
  list.innerHTML = "";
  TOOLS.forEach((tool) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = `<span class="tool-name">${tool.name}</span><span class="tool-meta">${tool.usesLlm ? "LLM authorship" : "Deterministic"}</span>`;
    btn.addEventListener("click", () => selectTool(tool.name));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function selectTool(name) {
  state.selectedTool = TOOLS.find((t) => t.name === name) || null;
  document.querySelectorAll(".tool-list button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.querySelector(".tool-name")?.textContent === name);
  });

  const tool = state.selectedTool;
  const detail = $("tool-detail");
  const args = $("tool-args");
  const run = $("run-tool");
  const response = $("tool-response");

  if (!tool) {
    detail.innerHTML = `<p class="empty">Select a tool to inspect its schema and run it.</p>`;
    args.disabled = true;
    run.disabled = true;
    return;
  }

  detail.innerHTML = `
    <h3>${tool.name}</h3>
    <p>${tool.description}</p>
    <div class="badge-row">
      <span class="badge">${tool.usesLlm ? "Uses Gemini" : "No LLM"}</span>
      <span class="badge">SHARP FHIR headers</span>
      ${tool.usesLlm ? `<span class="badge llm">Authorship only</span>` : ""}
    </div>
  `;
  args.value = JSON.stringify(tool.argsSchema, null, 2);
  args.disabled = false;
  run.disabled = false;
  response.textContent = "Ready. Press Run tool.";
  response.classList.remove("error", "loading");
}

async function runSelectedTool() {
  const tool = state.selectedTool;
  if (!tool) return;

  const responseEl = $("tool-response");
  responseEl.classList.remove("error");
  responseEl.classList.add("loading");
  responseEl.textContent = "Running…";

  let args = {};
  try {
    args = JSON.parse($("tool-args").value || "{}");
  } catch {
    responseEl.classList.remove("loading");
    responseEl.classList.add("error");
    responseEl.textContent = "Arguments must be valid JSON.";
    return;
  }

  const live = $("mcp-live-toggle").checked;
  try {
    let result;
    if (live) {
      result = await callLiveMcp(tool.name, args);
    } else {
      await sleep(350);
      result = tool.demo(args);
    }
    responseEl.classList.remove("loading");
    responseEl.textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    responseEl.classList.remove("loading");
    responseEl.classList.add("error");
    responseEl.textContent = String(err.message || err);
  }
}

async function callLiveMcp(name, args) {
  const url = ($("mcp-url").value || "").trim();
  if (!url) throw new Error("Set an MCP server URL first.");

  // Minimal JSON-RPC tools/call attempt. Most Streamable HTTP MCP servers
  // require an initialize handshake; demo mode is the reliable path on Pages.
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-FHIR-Server-URL": PATIENT.fhirUrl,
      "X-FHIR-Access-Token": "public-sandbox-no-token",
      "X-Patient-ID": PATIENT.id,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `MCP HTTP ${res.status}. Browser→MCP often needs CORS + initialize handshake. Use demo mode or the official MCP Inspector locally.\n\n${text.slice(0, 500)}`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function initMcpInspector() {
  renderToolList();
  selectTool("FindCareGaps");

  $("run-tool").addEventListener("click", runSelectedTool);
  $("copy-response").addEventListener("click", async () => {
    const text = $("tool-response").textContent || "";
    await navigator.clipboard.writeText(text);
    $("copy-response").textContent = "Copied";
    setTimeout(() => {
      $("copy-response").textContent = "Copy";
    }, 1200);
  });

  $("mcp-live-toggle").addEventListener("change", (e) => {
    const on = e.target.checked;
    $("mcp-url").disabled = !on;
    $("mcp-mode-label").textContent = on ? "Live" : "Demo";
  });
}

/* ── A2A chat ─────────────────────────────────────────────────────────── */

function appendMessage(role, text) {
  const log = $("chat-log");
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  if (role === "system") {
    el.textContent = text;
  } else {
    el.innerHTML = `<span class="who">${role === "user" ? "You" : "Agent"}</span>${escapeHtml(text)}`;
  }
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initChat() {
  const chips = $("prompt-chips");
  DEMO_PROMPTS.forEach((prompt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = prompt;
    btn.addEventListener("click", () => {
      $("chat-input").value = prompt;
      $("chat-form").requestSubmit();
    });
    chips.appendChild(btn);
  });

  appendMessage(
    "system",
    `Demo patient: ${PATIENT.name} (${PATIENT.age}F) · SMART Health IT Synthea sandbox`
  );

  $("a2a-live-toggle").addEventListener("change", (e) => {
    const on = e.target.checked;
    $("a2a-url").disabled = !on;
    $("a2a-key").disabled = !on;
  });

  $("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    appendMessage("user", text);

    const live = $("a2a-live-toggle").checked;
    const thinking = appendMessage("agent", live ? "Calling A2A agent…" : "Thinking…");
    thinking.classList.add("loading");

    try {
      const reply = live ? await callLiveA2a(text) : await callDemoA2a(text);
      thinking.remove();
      appendMessage("agent", reply);
    } catch (err) {
      thinking.remove();
      appendMessage("agent", `Error: ${err.message || err}`);
    }
  });
}

async function callDemoA2a(text) {
  const { delayMs, text: reply } = demoAgentReply(text);
  await sleep(delayMs);
  return reply;
}

async function callLiveA2a(text) {
  const base = ($("a2a-url").value || "").trim().replace(/\/$/, "");
  const key = ($("a2a-key").value || "").trim();
  if (!base) throw new Error("Set an A2A agent URL first.");
  if (!key) throw new Error("Set X-API-Key (API_KEY_PRIMARY) first.");

  const res = await fetch(`${base}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": key,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "message/send",
      params: {
        metadata: {
          [FHIR_CONTEXT_URI]: {
            fhirUrl: PATIENT.fhirUrl,
            fhirToken: "public-sandbox-no-token",
            patientId: PATIENT.id,
          },
        },
        message: {
          kind: "message",
          message_id: crypto.randomUUID(),
          role: "user",
          parts: [{ kind: "text", text }],
        },
      },
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `A2A HTTP ${res.status}. If this is a CORS failure from GitHub Pages, enable CORS_ORIGINS on the agent.\n${JSON.stringify(data || {}, null, 2)}`
    );
  }

  return extractA2aText(data) || JSON.stringify(data, null, 2);
}

function extractA2aText(payload) {
  if (!payload || typeof payload !== "object") return null;

  const chunks = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node.text === "string") chunks.push(node.text);
    if (typeof node.content === "string") chunks.push(node.content);
    Object.values(node).forEach(visit);
  };
  visit(payload.result ?? payload);
  const joined = chunks.map((c) => c.trim()).filter(Boolean);
  return joined.length ? [...new Set(joined)].join("\n\n") : null;
}

/* ── Boot ─────────────────────────────────────────────────────────────── */

initTabs();
initMcpInspector();
initChat();
