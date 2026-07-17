const NODES = {
  clinician: {
    kicker: "Caller",
    title: "Clinician",
    body: "Asks in plain language over A2A JSON-RPC. Sends FHIR context in message metadata: fhirUrl, fhirToken, patientId.",
    bullets: [
      "Example: \"What preventive care gaps does this patient have?\"",
      "Can also ask for risk summary or an SMS draft.",
      "Gets a short bulleted answer back, not raw FHIR JSON.",
    ],
    tags: ["A2A client", "JSON-RPC"],
    links: ["ask", "reply"],
  },
  agent: {
    kicker: "care_gap_agent · :8001",
    title: "A2A agent",
    body: "Google ADK plus Gemini pick tools and keep evidence across turns. Middleware bridges FHIR metadata into session state before each model call.",
    bullets: [
      "Agent card at /.well-known/agent-card.json.",
      "Requires X-API-Key (API_KEY_PRIMARY).",
      "Proxies 6 tools to the MCP server.",
    ],
    tags: ["Google ADK", "Gemini", "A2A v1"],
    links: ["ask", "sharp", "reply", "outreach"],
  },
  mcp: {
    kicker: "care_gap_mcp · :9000/mcp",
    title: "MCP server",
    body: "FastMCP tools do the FHIR work and the authorship calls. FHIR credentials arrive as SHARP headers, not prompt text.",
    bullets: [
      "Headers: X-FHIR-Server-URL, X-FHIR-Access-Token, X-Patient-ID.",
      "Deterministic tools summarize the chart and roll up risk.",
      "LLM tools write rationale and outreach.",
    ],
    tags: ["FastMCP", "SHARP", "6 tools"],
    links: ["sharp", "fhir", "rules", "back"],
  },
  fhir: {
    kicker: "Data plane",
    title: "FHIR R4 server",
    body: "Source of truth for the chart. Default demo target is the SMART Health IT Synthea sandbox.",
    bullets: [
      "Resources: Patient, Condition, Observation, Procedure, Immunization.",
      "Codes include SNOMED, ICD-10, LOINC, CPT, and CVX.",
      "Access tokens stay in headers and session state.",
    ],
    tags: ["SMART-on-FHIR", "R4"],
    links: ["fhir", "back"],
  },
  rules: {
    kicker: "Deterministic",
    title: "YAML rule engine",
    body: "Marks what is overdue from structured evidence. The model does not invent gaps.",
    bullets: [
      "13 USPSTF and ACIP rules in care_gap_rules.yaml.",
      "Threshold shapes: observation, procedure, procedure_any, immunization.",
      "New fitting rules are YAML edits.",
    ],
    tags: ["USPSTF", "ACIP", "YAML"],
    links: ["rules", "gemini"],
  },
  gemini: {
    kicker: "Authorship",
    title: "Gemini",
    body: "Writes after a gap already exists: one-sentence clinical rationale, then patient SMS or portal copy.",
    bullets: [
      "Prompts live under care_gap_mcp/prompts/.",
      "Template fallback if Gemini is down.",
      "LiteLLM can route to other models.",
    ],
    tags: ["rationale", "SMS", "portal"],
    links: ["gemini", "back", "outreach"],
  },
};

const EDGES = {
  ask: {
    title: "A2A message",
    body: "Clinician → agent. Text plus fhir-context metadata on message/send.",
  },
  sharp: {
    title: "SHARP headers",
    body: "Agent → MCP. FHIR URL, token, and patient ID travel as HTTP headers.",
  },
  fhir: {
    title: "FHIR read / search",
    body: "MCP queries the chart. No LLM on this hop.",
  },
  rules: {
    title: "Evidence to rules",
    body: "Structured facts enter the YAML engine. Gaps are decided here.",
  },
  gemini: {
    title: "Gap to authorship",
    body: "An existing gap is handed to Gemini for a clinician rationale.",
  },
  back: {
    title: "Copy returns",
    body: "Rationale or outreach text flows back through MCP toward the agent.",
  },
  reply: {
    title: "Summary out",
    body: "Agent → clinician. Short bulleted answer over A2A.",
  },
  outreach: {
    title: "Draft request",
    body: "On the outreach scenario, the agent asks Gemini for SMS or portal copy after gaps exist.",
  },
};

const SCENARIOS = {
  gaps: {
    label: "Find gaps",
    steps: [
      {
        label: "Clinician asks over A2A",
        nodes: ["clinician"],
        edges: ["ask"],
        packet: "ask",
        detail: {
          kicker: "Step 1 · Find gaps",
          title: "Question in",
          body: "The caller sends message/send with text and the fhir-context metadata extension.",
          bullets: ["Transport: A2A JSON-RPC.", "Demo patient: Danae Kshlerin."],
          tags: ["message/send"],
        },
      },
      {
        label: "Agent loads FHIR context",
        nodes: ["agent"],
        edges: ["ask"],
        packet: "ask",
        detail: {
          kicker: "Step 2 · Find gaps",
          title: "care_gap_agent",
          body: "Middleware and fhir_hook pull fhirUrl, fhirToken, and patientId into ADK session state. Gemini chooses a tool.",
          bullets: ["API key checked first.", "Typical tool: find_care_gaps."],
          tags: ["session state"],
        },
      },
      {
        label: "Agent calls MCP with SHARP headers",
        nodes: ["agent", "mcp"],
        edges: ["sharp"],
        packet: "sharp",
        detail: {
          kicker: "Step 3 · Find gaps",
          title: "SHARP-on-MCP",
          body: "Each ADK tool forwards session FHIR values as HTTP headers to the MCP server.",
          bullets: ["X-FHIR-Server-URL", "X-FHIR-Access-Token", "X-Patient-ID"],
          tags: ["headers"],
        },
      },
      {
        label: "MCP reads the FHIR chart",
        nodes: ["mcp", "fhir"],
        edges: ["fhir"],
        packet: "fhir",
        detail: {
          kicker: "Step 4 · Find gaps",
          title: "FHIR read / search",
          body: "care_gap_mcp queries Patient, Condition, Observation, Procedure, and Immunization.",
          bullets: ["No LLM on this hop.", "Results become structured evidence."],
          tags: ["deterministic"],
        },
      },
      {
        label: "YAML rules mark overdue care",
        nodes: ["mcp", "rules"],
        edges: ["rules"],
        packet: "rules",
        detail: {
          kicker: "Step 5 · Find gaps",
          title: "Rule engine",
          body: "Rules compare ages, diagnoses, and last-done dates against USPSTF and ACIP thresholds.",
          bullets: [
            "Example: active diabetes + no LOINC 4548-4 in 6 months → HbA1c overdue.",
            "Gaps are decided before authorship.",
          ],
          tags: ["YAML"],
        },
      },
      {
        label: "Gemini writes the rationale",
        nodes: ["rules", "gemini", "mcp"],
        edges: ["gemini", "back"],
        packet: "gemini",
        detail: {
          kicker: "Step 6 · Find gaps",
          title: "Authorship",
          body: "Gemini gets an existing gap plus evidence and writes a one-sentence clinician rationale.",
          bullets: ["It cannot invent a new gap.", "Template fallback if Gemini is down."],
          tags: ["Gemini"],
        },
      },
      {
        label: "Agent returns a summary",
        nodes: ["agent", "clinician"],
        edges: ["reply"],
        packet: "reply",
        detail: {
          kicker: "Step 7 · Find gaps",
          title: "Answer out",
          body: "The agent turns tool JSON into a short clinician-facing summary and sends it back over A2A.",
          bullets: ["Bulleted gaps with severity and rationale.", "Follow-up turns can draft outreach."],
          tags: ["A2A"],
        },
      },
    ],
  },
  outreach: {
    label: "Draft outreach",
    steps: [
      {
        label: "Clinician asks for an SMS",
        nodes: ["clinician"],
        edges: ["ask"],
        packet: "ask",
        detail: {
          kicker: "Step 1 · Draft outreach",
          title: "Outreach ask",
          body: "After gaps are known, the caller asks for patient-facing copy for one gap.",
          bullets: ["Example: \"Draft an SMS about the A1c.\"", "Same FHIR context rides along."],
          tags: ["SMS"],
        },
      },
      {
        label: "Agent routes to draft_outreach_message",
        nodes: ["agent"],
        edges: ["ask", "outreach"],
        packet: "outreach",
        detail: {
          kicker: "Step 2 · Draft outreach",
          title: "Tool choice",
          body: "Gemini picks draft_outreach_message and passes the gap object already found.",
          bullets: ["Gap must already exist.", "Channel can be sms, portal, or both."],
          tags: ["tool call"],
        },
      },
      {
        label: "MCP + Gemini write patient copy",
        nodes: ["mcp", "gemini"],
        edges: ["outreach", "gemini", "back"],
        packet: "back",
        detail: {
          kicker: "Step 3 · Draft outreach",
          title: "Patient language",
          body: "Gemini drafts sixth-grade reading-level copy. SMS stays under about 160 characters.",
          bullets: ["Tone prompts live in Markdown files.", "No new clinical facts are invented."],
          tags: ["authorship"],
        },
      },
      {
        label: "Draft returns to the clinician",
        nodes: ["agent", "clinician"],
        edges: ["reply"],
        packet: "reply",
        detail: {
          kicker: "Step 4 · Draft outreach",
          title: "Ready to send",
          body: "The agent returns the draft. A care manager can paste it into SMS or the portal.",
          bullets: ["Still grounded in the same gap evidence.", "Tokens never entered the prompt."],
          tags: ["A2A"],
        },
      },
    ],
  },
};

const DEFAULT_DETAIL = {
  kicker: "Request path",
  title: "How a question moves",
  body: "A clinician asks over A2A. The agent calls MCP with FHIR context in headers. MCP reads the chart, runs YAML rules, asks Gemini to write copy, then returns a summary.",
  bullets: [
    "Hover a box to light its links.",
    "Click a wire chip for that hop.",
    "Play walks a full scenario with a moving packet.",
  ],
  tags: ["interactive"],
};

function $(id) {
  return document.getElementById(id);
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function currentSteps() {
  return SCENARIOS[scenario].steps;
}

function renderDetail(detail) {
  const root = $("arch-detail");
  if (!root) return;
  const tags = detail.tags || [];
  root.classList.remove("is-fresh");
  void root.offsetWidth;
  root.innerHTML = `
    <p class="arch-detail-kicker">${detail.kicker}</p>
    <h3>${detail.title}</h3>
    <p>${detail.body}</p>
    ${tags.length ? `<div class="arch-tags">${tags.map((t) => `<span>${t}</span>`).join("")}</div>` : ""}
    <ul>
      ${detail.bullets.map((b) => `<li>${b}</li>`).join("")}
    </ul>
  `;
  root.classList.add("is-fresh");
}

function clearHighlights() {
  document.querySelectorAll(".arch-node").forEach((n) => {
    n.classList.remove("is-active", "is-done", "is-selected", "is-dim", "is-hot");
  });
  document
    .querySelectorAll(".arch-wires .wire, .arch-wires .wire-labels text")
    .forEach((el) => {
      el.classList.remove("is-active", "is-done", "is-hot");
    });
  hidePacket();
}

function setEdgeState(edgeId, state) {
  document.querySelectorAll(`[data-edge="${edgeId}"]`).forEach((el) => {
    if (el.closest(".wire-hitboxes")) return;
    el.classList.add(state);
  });
  const wire = document.querySelector(`.wire[data-edge="${edgeId}"]`);
  if (wire && state === "is-active") {
    wire.setAttribute("marker-end", "url(#arrow-active)");
  } else if (wire && state !== "is-active") {
    wire.setAttribute("marker-end", "url(#arrow)");
  }
}

function highlightConnections(edgeIds, nodeIds = []) {
  document.querySelectorAll(".arch-node").forEach((n) => n.classList.add("is-dim"));
  nodeIds.forEach((id) => {
    const el = document.querySelector(`.arch-node[data-node="${id}"]`);
    if (el) {
      el.classList.remove("is-dim");
      el.classList.add("is-hot");
    }
  });
  edgeIds.forEach((id) => setEdgeState(id, "is-hot"));
}

function highlightStep(step) {
  step.nodes.forEach((id) => {
    const el = document.querySelector(`.arch-node[data-node="${id}"]`);
    if (el) {
      el.classList.remove("is-dim");
      el.classList.add("is-active");
    }
  });
  step.edges.forEach((id) => setEdgeState(id, "is-active"));
  renderDetail(step.detail);
  $("arch-step-label").textContent = `${stepIndex + 1}/${currentSteps().length} · ${step.label}`;
  updateScrub();
}

function hidePacket() {
  const packet = $("arch-packet");
  if (!packet) return;
  packet.classList.remove("is-visible");
  packet.setAttribute("cx", "-20");
  packet.setAttribute("cy", "-20");
}

function animatePacket(edgeId) {
  const packet = $("arch-packet");
  const path = document.querySelector(`.wire[data-edge="${edgeId}"]`);
  if (!packet || !path) return Promise.resolve();

  if (reducedMotion()) {
    const len = path.getTotalLength();
    const pt = path.getPointAtLength(len);
    packet.setAttribute("cx", pt.x);
    packet.setAttribute("cy", pt.y);
    packet.classList.add("is-visible");
    return Promise.resolve();
  }

  const len = path.getTotalLength();
  const duration = 900 / speed;
  packet.classList.add("is-visible");

  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      if (!playing && stepIndex < 0) {
        hidePacket();
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const pt = path.getPointAtLength(len * ease);
      packet.setAttribute("cx", pt.x);
      packet.setAttribute("cy", pt.y);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

function pinNode(nodeId) {
  stopPlayback();
  stepIndex = -1;
  pinned = { type: "node", id: nodeId };
  clearHighlights();
  const el = document.querySelector(`.arch-node[data-node="${nodeId}"]`);
  const detail = NODES[nodeId];
  if (!detail || !el) return;
  highlightConnections(detail.links, [nodeId]);
  el.classList.add("is-selected", "is-active");
  renderDetail({
    kicker: detail.kicker,
    title: detail.title,
    body: detail.body,
    bullets: detail.bullets,
    tags: detail.tags,
  });
  $("arch-step-label").textContent = `Selected: ${detail.title}`;
  updateScrub();
  updateEdgeChips();
  updateButtons();
}

function pinEdge(edgeId) {
  stopPlayback();
  stepIndex = -1;
  pinned = { type: "edge", id: edgeId };
  clearHighlights();
  const edge = EDGES[edgeId];
  if (!edge) return;
  setEdgeState(edgeId, "is-active");
  const linked = Object.entries(NODES)
    .filter(([, n]) => n.links.includes(edgeId))
    .map(([id]) => id);
  linked.forEach((id) => {
    const el = document.querySelector(`.arch-node[data-node="${id}"]`);
    if (el) el.classList.add("is-active");
  });
  renderDetail({
    kicker: "Wire",
    title: edge.title,
    body: edge.body,
    bullets: linked.map((id) => NODES[id].title),
    tags: [edgeId],
  });
  $("arch-step-label").textContent = `Wire: ${edge.title}`;
  updateScrub();
  updateEdgeChips();
  updateButtons();
}

let playTimer = null;
let stepIndex = -1;
let playing = false;
let scenario = "gaps";
let speed = 1;
let pinned = null; // { type: 'node'|'edge', id }

function updateButtons() {
  const steps = currentSteps();
  const prev = $("arch-prev");
  const next = $("arch-next");
  if (prev) prev.disabled = playing || stepIndex <= 0;
  if (next) next.disabled = playing || stepIndex >= steps.length - 1;
  const playBtn = $("arch-play");
  if (playBtn) playBtn.textContent = playing ? "Pause" : "Play";
}

function updateScrub() {
  const scrub = $("arch-scrub");
  if (!scrub) return;
  [...scrub.children].forEach((li, i) => {
    li.classList.toggle("is-active", i === stepIndex);
    li.classList.toggle("is-done", i < stepIndex);
    li.setAttribute("aria-current", i === stepIndex ? "step" : "false");
  });
}

function buildScrub() {
  const scrub = $("arch-scrub");
  if (!scrub) return;
  const steps = currentSteps();
  scrub.innerHTML = steps
    .map(
      (s, i) =>
        `<li><button type="button" data-step="${i}" title="${s.label}"><span>${i + 1}</span><em>${s.label}</em></button></li>`
    )
    .join("");
  scrub.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      stopPlayback();
      goToStep(Number(btn.dataset.step));
    });
  });
}

function visibleEdgeIds() {
  const ids = new Set();
  currentSteps().forEach((step) => step.edges.forEach((e) => ids.add(e)));
  // Always expose core path wires for the gaps scenario; outreach adds its own.
  ["ask", "sharp", "fhir", "rules", "gemini", "back", "reply"].forEach((e) => ids.add(e));
  if (scenario === "outreach") ids.add("outreach");
  return [...ids];
}

function buildEdges() {
  const root = $("arch-edges");
  if (!root) return;
  const order = ["ask", "sharp", "fhir", "rules", "gemini", "back", "reply", "outreach"];
  const ids = visibleEdgeIds();
  root.innerHTML = order
    .filter((id) => ids.includes(id) && EDGES[id])
    .filter((id) => (scenario === "outreach" ? true : id !== "outreach"))
    .map(
      (id) =>
        `<button type="button" class="arch-edge-chip" data-edge="${id}">${EDGES[id].title}</button>`
    )
    .join("");
  root.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => pinEdge(btn.dataset.edge));
  });
  updateEdgeChips();
}

function updateEdgeChips() {
  const active = new Set();
  if (pinned?.type === "edge") active.add(pinned.id);
  if (stepIndex >= 0) {
    currentSteps()[stepIndex]?.edges.forEach((e) => active.add(e));
  }
  document.querySelectorAll(".arch-edge-chip").forEach((btn) => {
    btn.classList.toggle("is-active", active.has(btn.dataset.edge));
    btn.hidden = scenario !== "outreach" && btn.dataset.edge === "outreach";
  });
}

function stopPlayback() {
  playing = false;
  if (playTimer) {
    clearTimeout(playTimer);
    playTimer = null;
  }
  updateButtons();
}

function markVisitedUpTo(index) {
  const steps = currentSteps();
  for (let i = 0; i < index; i += 1) {
    steps[i].nodes.forEach((id) => {
      const el = document.querySelector(`.arch-node[data-node="${id}"]`);
      if (el) el.classList.add("is-done");
    });
    steps[i].edges.forEach((id) => setEdgeState(id, "is-done"));
  }
}

async function goToStep(index, { animate = true } = {}) {
  const steps = currentSteps();
  if (index < 0 || index >= steps.length) return;
  pinned = null;
  stepIndex = index;
  clearHighlights();
  document.querySelectorAll(".arch-node").forEach((n) => n.classList.add("is-dim"));
  markVisitedUpTo(index);
  const step = steps[index];
  highlightStep(step);
  updateEdgeChips();
  updateButtons();
  if (animate && step.packet) {
    await animatePacket(step.packet);
  }
}

function playFlow() {
  if (playing) {
    stopPlayback();
    return;
  }
  playing = true;
  updateButtons();
  const steps = currentSteps();
  const start = stepIndex < 0 || stepIndex >= steps.length - 1 ? 0 : stepIndex + 1;

  const tick = async (i) => {
    if (!playing) return;
    if (i >= steps.length) {
      stopPlayback();
      $("arch-step-label").textContent = "Flow complete. Reset or pick another scenario.";
      updateButtons();
      return;
    }
    await goToStep(i, { animate: true });
    if (!playing) return;
    playTimer = setTimeout(() => tick(i + 1), 700 / speed);
  };

  tick(start);
}

function resetFlow() {
  stopPlayback();
  stepIndex = -1;
  pinned = null;
  clearHighlights();
  renderDetail(DEFAULT_DETAIL);
  $("arch-step-label").textContent = "Idle. Hover a box, click a wire chip, or press Play.";
  updateScrub();
  updateEdgeChips();
  updateButtons();
}

function setScenario(name) {
  if (!SCENARIOS[name]) return;
  scenario = name;
  document.querySelectorAll(".arch-chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.scenario === name);
  });
  // Show/hide outreach wire visually when scenario changes
  document.querySelectorAll('[data-edge="outreach"]').forEach((el) => {
    el.classList.toggle("is-scenario", name === "outreach");
  });
  buildScrub();
  buildEdges();
  resetFlow();
  $("arch-step-label").textContent = `Scenario: ${SCENARIOS[name].label}. Press Play.`;
}

export function initArchitecture() {
  if (!$("arch-diagram")) return;

  document.querySelectorAll(".arch-node").forEach((btn) => {
    btn.addEventListener("click", () => pinNode(btn.dataset.node));
    btn.addEventListener("mouseenter", () => {
      if (playing || stepIndex >= 0 || pinned) return;
      const node = NODES[btn.dataset.node];
      if (!node) return;
      clearHighlights();
      highlightConnections(node.links, [btn.dataset.node]);
      btn.classList.add("is-selected");
    });
    btn.addEventListener("mouseleave", () => {
      if (playing || stepIndex >= 0 || pinned) return;
      clearHighlights();
    });
  });

  document.querySelectorAll(".wire-hitboxes path").forEach((path) => {
    path.style.cursor = "pointer";
    path.addEventListener("click", (event) => {
      event.stopPropagation();
      pinEdge(path.dataset.edge);
    });
    path.addEventListener("mouseenter", () => {
      if (playing || stepIndex >= 0 || pinned) return;
      clearHighlights();
      setEdgeState(path.dataset.edge, "is-hot");
    });
    path.addEventListener("mouseleave", () => {
      if (playing || stepIndex >= 0 || pinned) return;
      clearHighlights();
    });
  });

  // SVG labels sit under nodes; keep them as hover hints only.
  // Reliable wire selection is via .arch-edge-chip buttons.

  document.querySelectorAll(".arch-chip").forEach((chip) => {
    chip.addEventListener("click", () => setScenario(chip.dataset.scenario));
  });

  $("arch-play").addEventListener("click", playFlow);
  $("arch-next").addEventListener("click", () => {
    stopPlayback();
    goToStep(stepIndex < 0 ? 0 : stepIndex + 1);
  });
  $("arch-prev").addEventListener("click", () => {
    stopPlayback();
    if (stepIndex > 0) goToStep(stepIndex - 1);
  });
  $("arch-reset").addEventListener("click", resetFlow);

  $("arch-speed").addEventListener("input", (e) => {
    speed = Number(e.target.value) || 1;
  });

  const stage = $("arch-stage");
  stage.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      playFlow();
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      stopPlayback();
      goToStep(stepIndex < 0 ? 0 : stepIndex + 1);
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      stopPlayback();
      if (stepIndex > 0) goToStep(stepIndex - 1);
    } else if (e.code === "Escape") {
      resetFlow();
    }
  });

  setScenario("gaps");
}
