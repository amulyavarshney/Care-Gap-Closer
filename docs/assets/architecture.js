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
  },
  agent: {
    kicker: "care_gap_agent · :8001",
    title: "A2A agent",
    body: "Google ADK plus Gemini pick tools and keep evidence across turns. Middleware bridges FHIR metadata into session state before each model call.",
    bullets: [
      "Speaks A2A v1. Agent card at /.well-known/agent-card.json.",
      "Requires X-API-Key (API_KEY_PRIMARY).",
      "Proxies 6 tools to the MCP server. Holds no FHIR query logic of its own.",
    ],
  },
  mcp: {
    kicker: "care_gap_mcp · :9000/mcp",
    title: "MCP server",
    body: "FastMCP tools do the FHIR work and the authorship calls. FHIR credentials arrive as SHARP headers, not prompt text.",
    bullets: [
      "Headers: X-FHIR-Server-URL, X-FHIR-Access-Token, X-Patient-ID.",
      "Deterministic tools: SummarizePatient, ListActiveConditions, ListRecentObservations, GetPatientRiskSummary.",
      "LLM tools: FindCareGaps (rationale), DraftOutreachMessage (SMS / portal).",
    ],
  },
  fhir: {
    kicker: "Data plane",
    title: "FHIR R4 server",
    body: "Source of truth for the chart. Default demo target is the SMART Health IT Synthea sandbox. Any SMART-on-FHIR R4 endpoint works.",
    bullets: [
      "Resources used: Patient, Condition, Observation, Procedure, Immunization.",
      "Codes checked include SNOMED, ICD-10, LOINC, CPT, and CVX.",
      "The agent never sees the access token in a prompt.",
    ],
  },
  rules: {
    kicker: "Deterministic",
    title: "YAML rule engine",
    body: "Marks what is overdue from structured evidence. The model does not invent gaps.",
    bullets: [
      "13 USPSTF and ACIP rules in care_gap_rules.yaml.",
      "Threshold shapes: observation, procedure, procedure_any, immunization.",
      "New rules that fit those shapes are YAML edits, not Python changes.",
    ],
  },
  gemini: {
    kicker: "Authorship",
    title: "Gemini",
    body: "Writes after a gap already exists: one-sentence clinical rationale, then patient SMS or portal copy at about a sixth-grade reading level.",
    bullets: [
      "Prompt files live under care_gap_mcp/prompts/.",
      "If Gemini is down, each rule falls back to its rationale_template.",
      "The agent can also route models through LiteLLM.",
    ],
  },
};

const SCENARIOS = {
  gaps: {
    id: "gaps",
    label: "Find gaps",
    steps: [
      {
        label: "Clinician asks over A2A",
        packet: "ask",
        nodes: ["clinician"],
        edges: ["ask"],
        detail: {
          kicker: "Step 1 · Find gaps",
          title: "Question in",
          body: "The caller sends message/send with text and the fhir-context metadata extension.",
          bullets: [
            "Transport: A2A JSON-RPC.",
            "Patient example: Danae Kshlerin on r4.smarthealthit.org.",
          ],
        },
      },
      {
        label: "Agent loads FHIR context",
        packet: "ask",
        nodes: ["agent"],
        edges: ["ask"],
        detail: {
          kicker: "Step 2 · Find gaps",
          title: "care_gap_agent",
          body: "Middleware and fhir_hook pull fhirUrl, fhirToken, and patientId into ADK session state before Gemini chooses a tool.",
          bullets: [
            "API key checked first.",
            "Gemini picks find_care_gaps.",
          ],
        },
      },
      {
        label: "Agent calls MCP with SHARP headers",
        packet: "sharp",
        nodes: ["agent", "mcp"],
        edges: ["sharp"],
        detail: {
          kicker: "Step 3 · Find gaps",
          title: "SHARP-on-MCP",
          body: "Each ADK tool forwards session FHIR values as HTTP headers to the MCP server.",
          bullets: [
            "X-FHIR-Server-URL",
            "X-FHIR-Access-Token",
            "X-Patient-ID",
          ],
        },
      },
      {
        label: "MCP reads the FHIR chart",
        packet: "fhir",
        nodes: ["mcp", "fhir"],
        edges: ["fhir"],
        detail: {
          kicker: "Step 4 · Find gaps",
          title: "FHIR read / search",
          body: "care_gap_mcp queries Patient, Condition, Observation, Procedure, and Immunization for the current patient.",
          bullets: [
            "No LLM on this hop.",
            "Results become structured evidence for the rules.",
          ],
        },
      },
      {
        label: "YAML rules mark overdue care",
        packet: "rules",
        nodes: ["mcp", "rules"],
        edges: ["rules"],
        detail: {
          kicker: "Step 5 · Find gaps",
          title: "Rule engine",
          body: "Rules compare ages, diagnoses, and last-done dates against USPSTF and ACIP thresholds.",
          bullets: [
            "Example: active diabetes + no LOINC 4548-4 in 6 months → HbA1c overdue.",
            "Gaps are decided here, before any authorship call.",
          ],
        },
      },
      {
        label: "Gemini writes rationale",
        packet: "gemini",
        nodes: ["rules", "gemini", "mcp"],
        edges: ["gemini", "back"],
        detail: {
          kicker: "Step 6 · Find gaps",
          title: "Authorship",
          body: "Gemini gets an existing gap plus evidence and writes a one-sentence clinician rationale.",
          bullets: [
            "It cannot invent a new gap.",
            "Template fallback if GOOGLE_API_KEY fails.",
          ],
        },
      },
      {
        label: "Agent returns a summary",
        packet: "reply",
        nodes: ["agent", "clinician"],
        edges: ["reply", "back"],
        detail: {
          kicker: "Step 7 · Find gaps",
          title: "Answer out",
          body: "The agent turns tool JSON into a short clinician-facing summary and sends it back over A2A.",
          bullets: [
            "Typical output: bulleted gaps with severity and rationale.",
            "A follow-up turn can draft outreach for one gap.",
          ],
        },
      },
    ],
  },
  outreach: {
    id: "outreach",
    label: "Draft outreach",
    steps: [
      {
        label: "Clinician asks for an SMS",
        packet: "ask",
        nodes: ["clinician"],
        edges: ["ask"],
        detail: {
          kicker: "Step 1 · Draft outreach",
          title: "Outreach ask",
          body: "Same A2A path, different intent: draft patient copy for a gap already found.",
          bullets: [
            "Example: \"Draft an SMS about the A1c.\"",
            "FHIR context still rides in metadata.",
          ],
        },
      },
      {
        label: "Agent routes to draft_outreach_message",
        packet: "ask",
        nodes: ["agent"],
        edges: ["ask"],
        detail: {
          kicker: "Step 2 · Draft outreach",
          title: "Tool choice",
          body: "Gemini picks draft_outreach_message and passes the gap object from the earlier turn.",
          bullets: [
            "FindCareGaps should already have run.",
            "Channel can be sms, portal, or both.",
          ],
        },
      },
      {
        label: "MCP receives the gap + SHARP headers",
        packet: "sharp",
        nodes: ["agent", "mcp"],
        edges: ["sharp"],
        detail: {
          kicker: "Step 3 · Draft outreach",
          title: "MCP tool call",
          body: "DraftOutreachMessage gets the gap dict, optional patient name, and channel. FHIR headers still identify the patient.",
          bullets: [
            "No new gap is invented here.",
            "Tone comes from prompts/outreach_sms.md and tone_guide.md.",
          ],
        },
      },
      {
        label: "Gemini writes patient copy",
        packet: "gemini",
        nodes: ["mcp", "gemini"],
        edges: ["gemini", "back"],
        detail: {
          kicker: "Step 4 · Draft outreach",
          title: "Patient language",
          body: "Gemini drafts SMS (under 160 characters) or a short portal note at about a sixth-grade reading level.",
          bullets: [
            "Grounded in the gap evidence already on hand.",
            "Returns message text and character_count.",
          ],
        },
      },
      {
        label: "Agent shows the draft",
        packet: "reply",
        nodes: ["agent", "clinician"],
        edges: ["reply"],
        detail: {
          kicker: "Step 5 · Draft outreach",
          title: "Draft out",
          body: "The clinician sees ready-to-send copy. They can ask for a portal version next.",
          bullets: [
            "Still A2A JSON-RPC on the way out.",
            "No FHIR token in the model prompt.",
          ],
        },
      },
    ],
  },
};

const DEFAULT_DETAIL = {
  kicker: "Request path",
  title: "How a question moves",
  body: "A clinician asks over A2A. The agent calls MCP with FHIR context in headers. MCP reads the chart, runs YAML rules, asks Gemini to write copy, then returns a summary. Tokens never enter a prompt.",
  bullets: [
    "Hover a box to see its links. Click for details.",
    "Play walks one scenario. Switch Find gaps / Draft outreach to change the path.",
  ],
};

const SPEEDS = {
  slow: 2400,
  normal: 1500,
  fast: 850,
};

function $(id) {
  return document.getElementById(id);
}

let scenarioId = "gaps";
let stepIndex = -1;
let playing = false;
let playTimer = null;
let speed = "normal";
let packetRaf = null;
let hoverNode = null;

function flow() {
  return SCENARIOS[scenarioId].steps;
}

function renderDetail(detail, { stepNum = null, stepTotal = null } = {}) {
  const root = $("arch-detail");
  if (!root) return;
  const counter =
    stepNum != null
      ? `<div class="arch-detail-counter">${stepNum} / ${stepTotal}</div>`
      : "";
  root.classList.remove("is-fresh");
  void root.offsetWidth;
  root.classList.add("is-fresh");
  root.innerHTML = `
    ${counter}
    <p class="arch-detail-kicker">${detail.kicker}</p>
    <h3>${detail.title}</h3>
    <p>${detail.body}</p>
    <ul>
      ${detail.bullets.map((b) => `<li>${b}</li>`).join("")}
    </ul>
  `;
}

function clearHighlights({ keepDim = false } = {}) {
  document.querySelectorAll(".arch-node").forEach((n) => {
    n.classList.remove("is-active", "is-done", "is-selected", "is-pulse");
    if (!keepDim) n.classList.remove("is-dim");
  });
  document.querySelectorAll(".arch-wires .wire, .arch-wires .wire-glow, .arch-wires .wire-labels text").forEach((el) => {
    el.classList.remove("is-active", "is-done", "is-dim");
  });
  document.querySelectorAll(".arch-progress-dot").forEach((d) => {
    d.classList.remove("is-active", "is-done");
  });
  $("arch-stage")?.classList.remove("is-playing", "has-focus");
}

function setEdgeState(edgeId, state) {
  document.querySelectorAll(`[data-edge="${edgeId}"]`).forEach((el) => {
    el.classList.remove("is-active", "is-done", "is-dim");
    if (state) el.classList.add(state);
  });
}

function highlightStep(step, { accumulate = false } = {}) {
  if (!accumulate) clearHighlights();

  $("arch-stage")?.classList.add("is-playing");

  step.nodes.forEach((id) => {
    const el = document.querySelector(`.arch-node[data-node="${id}"]`);
    if (el) {
      el.classList.add("is-active", "is-pulse");
      el.classList.remove("is-dim");
    }
  });

  step.edges.forEach((id) => setEdgeState(id, "is-active"));

  const steps = flow();
  const idx = steps.indexOf(step);
  document.querySelectorAll(".arch-progress-dot").forEach((dot, i) => {
    dot.classList.toggle("is-active", i === idx);
    dot.classList.toggle("is-done", i < idx);
  });

  renderDetail(step.detail, { stepNum: idx + 1, stepTotal: steps.length });
  $("arch-step-label").textContent = `${idx + 1}. ${step.label}`;
}

function focusNodeLinks(nodeId, { sticky = false } = {}) {
  const linked = new Set([nodeId]);
  const linkedEdges = new Set();

  // Edges that touch this node in either scenario
  const adjacency = {
    clinician: ["ask", "reply"],
    agent: ["ask", "sharp", "reply"],
    mcp: ["sharp", "fhir", "rules", "gemini", "back"],
    fhir: ["fhir"],
    rules: ["rules", "gemini"],
    gemini: ["gemini", "back"],
  };
  (adjacency[nodeId] || []).forEach((e) => linkedEdges.add(e));
  if (nodeId === "clinician") linked.add("agent");
  if (nodeId === "agent") {
    linked.add("clinician");
    linked.add("mcp");
  }
  if (nodeId === "mcp") {
    linked.add("agent");
    linked.add("fhir");
    linked.add("rules");
    linked.add("gemini");
  }
  if (nodeId === "fhir") linked.add("mcp");
  if (nodeId === "rules") {
    linked.add("mcp");
    linked.add("gemini");
  }
  if (nodeId === "gemini") {
    linked.add("rules");
    linked.add("mcp");
  }

  $("arch-stage")?.classList.add("has-focus");
  document.querySelectorAll(".arch-node").forEach((n) => {
    const on = linked.has(n.dataset.node);
    n.classList.toggle("is-dim", !on);
    n.classList.toggle("is-active", on && n.dataset.node === nodeId);
    n.classList.toggle("is-selected", sticky && n.dataset.node === nodeId);
  });
  document.querySelectorAll(".arch-wires .wire, .arch-wires .wire-glow").forEach((el) => {
    const on = linkedEdges.has(el.dataset.edge);
    el.classList.toggle("is-dim", !on);
    el.classList.toggle("is-active", on);
  });
  document.querySelectorAll(".arch-wires .wire-labels text").forEach((el) => {
    const on = linkedEdges.has(el.dataset.edge);
    el.classList.toggle("is-dim", !on);
    el.classList.toggle("is-active", on);
  });
}

function selectNode(nodeId) {
  stopPlayback();
  clearHighlights();
  hoverNode = null;
  focusNodeLinks(nodeId, { sticky: true });
  const detail = NODES[nodeId];
  if (detail) {
    renderDetail({
      kicker: detail.kicker,
      title: detail.title,
      body: detail.body,
      bullets: detail.bullets,
    });
    $("arch-step-label").textContent = `Selected: ${detail.title}`;
  }
  hidePacket();
}

function updateStepButton() {
  const stepBtn = $("arch-step");
  const prevBtn = $("arch-prev");
  if (stepBtn) stepBtn.disabled = playing || stepIndex >= flow().length - 1;
  if (prevBtn) prevBtn.disabled = playing || stepIndex <= 0;
  $("arch-play")?.classList.toggle("is-playing", playing);
}

function stopPlayback() {
  playing = false;
  if (playTimer) {
    clearTimeout(playTimer);
    playTimer = null;
  }
  const playBtn = $("arch-play");
  if (playBtn) {
    playBtn.textContent = "Play flow";
    playBtn.setAttribute("aria-pressed", "false");
  }
  updateStepButton();
}

function markVisitedUpTo(index) {
  for (let i = 0; i < index; i += 1) {
    flow()[i].nodes.forEach((id) => {
      document.querySelector(`.arch-node[data-node="${id}"]`)?.classList.add("is-done");
    });
    flow()[i].edges.forEach((id) => setEdgeState(id, "is-done"));
  }
}

function hidePacket() {
  if (packetRaf) cancelAnimationFrame(packetRaf);
  packetRaf = null;
  const packet = $("arch-packet");
  if (packet) {
    packet.classList.remove("is-visible");
    packet.style.transform = "";
  }
}

function animatePacket(edgeId, duration) {
  const path = document.querySelector(`.wire[data-edge="${edgeId}"]`);
  const packet = $("arch-packet");
  const stage = $("arch-stage");
  if (!path || !packet || !stage) return Promise.resolve();

  const length = path.getTotalLength();
  const svg = path.ownerSVGElement;
  const stageRect = stage.getBoundingClientRect();
  const ctm = svg.getScreenCTM();
  if (!ctm) return Promise.resolve();

  packet.classList.add("is-visible");
  const start = performance.now();

  return new Promise((resolve) => {
    const frame = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const pt = path.getPointAtLength(length * eased);
      const screen = svg.createSVGPoint();
      screen.x = pt.x;
      screen.y = pt.y;
      const transformed = screen.matrixTransform(ctm);
      const x = transformed.x - stageRect.left;
      const y = transformed.y - stageRect.top;
      packet.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (t < 1) {
        packetRaf = requestAnimationFrame(frame);
      } else {
        packetRaf = null;
        resolve();
      }
    };
    packetRaf = requestAnimationFrame(frame);
  });
}

async function goToStep(index, { animate = true } = {}) {
  const steps = flow();
  if (index < 0 || index >= steps.length) return;
  stepIndex = index;
  clearHighlights();
  markVisitedUpTo(index);
  const step = steps[index];
  highlightStep(step, { accumulate: true });
  updateStepButton();
  syncProgressAria();

  if (animate && step.packet && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const dur = Math.min(900, SPEEDS[speed] * 0.55);
    await animatePacket(step.packet, dur);
  } else {
    hidePacket();
  }
}

function playFlow() {
  if (playing) {
    stopPlayback();
    return;
  }
  playing = true;
  const playBtn = $("arch-play");
  if (playBtn) {
    playBtn.textContent = "Pause";
    playBtn.setAttribute("aria-pressed", "true");
  }
  updateStepButton();

  const start = stepIndex < 0 || stepIndex >= flow().length - 1 ? 0 : stepIndex + 1;

  const tick = async (i) => {
    if (!playing) return;
    if (i >= flow().length) {
      stopPlayback();
      hidePacket();
      $("arch-step-label").textContent = "Flow complete. Reset or switch scenario.";
      updateStepButton();
      return;
    }
    await goToStep(i, { animate: true });
    if (!playing) return;
    playTimer = setTimeout(() => tick(i + 1), SPEEDS[speed]);
  };

  tick(start);
}

function resetFlow() {
  stopPlayback();
  stepIndex = -1;
  hoverNode = null;
  clearHighlights();
  hidePacket();
  renderDetail(DEFAULT_DETAIL);
  $("arch-step-label").textContent = "Idle. Hover a node, click it, or press Play.";
  updateStepButton();
  syncProgressAria();
}

function buildProgress() {
  const rail = $("arch-progress");
  if (!rail) return;
  const steps = flow();
  rail.innerHTML = steps
    .map(
      (step, i) => `
      <button type="button" class="arch-progress-dot" data-step="${i}" aria-label="Step ${i + 1}: ${step.label}" title="${i + 1}. ${step.label}">
        <span class="arch-progress-num">${i + 1}</span>
        <span class="arch-progress-name">${step.label}</span>
      </button>`
    )
    .join("");
  rail.querySelectorAll(".arch-progress-dot").forEach((btn) => {
    btn.addEventListener("click", () => {
      stopPlayback();
      goToStep(Number(btn.dataset.step), { animate: true });
    });
  });
}

function syncProgressAria() {
  document.querySelectorAll(".arch-progress-dot").forEach((dot, i) => {
    dot.setAttribute("aria-current", i === stepIndex ? "step" : "false");
  });
}

function setScenario(id) {
  if (!SCENARIOS[id]) return;
  scenarioId = id;
  document.querySelectorAll(".arch-scenario").forEach((btn) => {
    const on = btn.dataset.scenario === id;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  $("arch-diagram")?.setAttribute("data-scenario", id);
  buildProgress();
  resetFlow();
  $("arch-step-label").textContent = `Scenario: ${SCENARIOS[id].label}. Press Play.`;
}

function setSpeed(next) {
  if (!SPEEDS[next]) return;
  speed = next;
  document.querySelectorAll(".arch-speed").forEach((btn) => {
    const on = btn.dataset.speed === next;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

export function initArchitecture() {
  if (!$("arch-diagram")) return;

  buildProgress();

  document.querySelectorAll(".arch-node").forEach((btn) => {
    btn.addEventListener("click", () => selectNode(btn.dataset.node));
    btn.addEventListener("mouseenter", () => {
      if (playing || stepIndex >= 0) return;
      hoverNode = btn.dataset.node;
      focusNodeLinks(hoverNode);
    });
    btn.addEventListener("mouseleave", () => {
      if (playing || stepIndex >= 0) return;
      if (hoverNode === btn.dataset.node) {
        hoverNode = null;
        clearHighlights();
      }
    });
    btn.addEventListener("focus", () => {
      if (playing) return;
      focusNodeLinks(btn.dataset.node);
    });
  });

  $("arch-stage")?.addEventListener("mouseleave", () => {
    if (playing || stepIndex >= 0 || !hoverNode) return;
    hoverNode = null;
    clearHighlights();
  });

  $("arch-play").addEventListener("click", playFlow);
  $("arch-step").addEventListener("click", () => {
    stopPlayback();
    goToStep(stepIndex < 0 ? 0 : stepIndex + 1, { animate: true });
  });
  $("arch-prev")?.addEventListener("click", () => {
    stopPlayback();
    if (stepIndex > 0) goToStep(stepIndex - 1, { animate: true });
  });
  $("arch-reset").addEventListener("click", resetFlow);

  document.querySelectorAll(".arch-scenario").forEach((btn) => {
    btn.addEventListener("click", () => setScenario(btn.dataset.scenario));
  });
  document.querySelectorAll(".arch-speed").forEach((btn) => {
    btn.addEventListener("click", () => setSpeed(btn.dataset.speed));
  });

  document.addEventListener("keydown", (e) => {
    const section = $("architecture");
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    if (!inView) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      stopPlayback();
      goToStep(stepIndex < 0 ? 0 : Math.min(flow().length - 1, stepIndex + 1), { animate: true });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      stopPlayback();
      if (stepIndex > 0) goToStep(stepIndex - 1, { animate: true });
    } else if (e.key === " ") {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      playFlow();
    }
  });

  renderDetail(DEFAULT_DETAIL);
  updateStepButton();
  setSpeed("normal");
  $("arch-diagram")?.setAttribute("data-scenario", scenarioId);
}
