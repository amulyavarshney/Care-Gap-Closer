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

const FLOW = [
  {
    label: "1. Clinician asks over A2A",
    nodes: ["clinician"],
    edges: ["ask"],
    detail: {
      kicker: "Step 1",
      title: "Question in",
      body: "The caller sends message/send with text and the fhir-context metadata extension.",
      bullets: [
        "Transport: A2A JSON-RPC.",
        "Patient example: Danae Kshlerin on r4.smarthealthit.org.",
      ],
    },
  },
  {
    label: "2. Agent loads FHIR context",
    nodes: ["agent"],
    edges: ["ask"],
    detail: {
      kicker: "Step 2",
      title: "care_gap_agent",
      body: "Middleware and fhir_hook pull fhirUrl, fhirToken, and patientId into ADK session state before Gemini chooses a tool.",
      bullets: [
        "API key checked first.",
        "Gemini decides find_care_gaps (or another tool).",
      ],
    },
  },
  {
    label: "3. Agent calls MCP with SHARP headers",
    nodes: ["agent", "mcp"],
    edges: ["sharp"],
    detail: {
      kicker: "Step 3",
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
    label: "4. MCP reads the FHIR chart",
    nodes: ["mcp", "fhir"],
    edges: ["fhir"],
    detail: {
      kicker: "Step 4",
      title: "FHIR read / search",
      body: "care_gap_mcp queries Patient, Condition, Observation, Procedure, and Immunization for the current patient.",
      bullets: [
        "No LLM on this hop.",
        "Results become structured evidence for the rules.",
      ],
    },
  },
  {
    label: "5. YAML rules mark overdue care",
    nodes: ["mcp", "rules"],
    edges: ["rules"],
    detail: {
      kicker: "Step 5",
      title: "Rule engine",
      body: "Rules compare ages, diagnoses, and last-done dates against USPSTF and ACIP thresholds.",
      bullets: [
        "Example: active diabetes + no LOINC 4548-4 in 6 months → HbA1c overdue.",
        "Gaps are decided here, before any authorship call.",
      ],
    },
  },
  {
    label: "6. Gemini writes rationale (and outreach if asked)",
    nodes: ["rules", "gemini", "mcp"],
    edges: ["gemini", "back"],
    detail: {
      kicker: "Step 6",
      title: "Authorship",
      body: "Gemini gets an existing gap plus evidence. It writes a clinician sentence, or SMS / portal copy if DraftOutreachMessage was called.",
      bullets: [
        "It cannot invent a new gap.",
        "Template fallback if GOOGLE_API_KEY fails.",
      ],
    },
  },
  {
    label: "7. Agent returns a summary",
    nodes: ["agent", "clinician"],
    edges: ["reply"],
    detail: {
      kicker: "Step 7",
      title: "Answer out",
      body: "The agent turns tool JSON into a short clinician-facing summary and sends it back over A2A.",
      bullets: [
        "Typical output: bulleted gaps with severity and rationale.",
        "Follow-up turns can draft outreach for one gap.",
      ],
    },
  },
];

const DEFAULT_DETAIL = {
  kicker: "Request path",
  title: "How a question moves",
  body: "A clinician asks over A2A. The agent calls MCP with FHIR context in headers. MCP reads the chart, runs YAML rules, asks Gemini to write copy, then returns a summary. Tokens never enter a prompt.",
  bullets: [
    "Click any box for that component.",
    "Play flow walks one \"find gaps\" request step by step.",
  ],
};

function $(id) {
  return document.getElementById(id);
}

function renderDetail(detail) {
  const root = $("arch-detail");
  if (!root) return;
  root.innerHTML = `
    <p class="arch-detail-kicker">${detail.kicker}</p>
    <h3>${detail.title}</h3>
    <p>${detail.body}</p>
    <ul>
      ${detail.bullets.map((b) => `<li>${b}</li>`).join("")}
    </ul>
  `;
}

function clearHighlights() {
  document.querySelectorAll(".arch-node").forEach((n) => {
    n.classList.remove("is-active", "is-done", "is-selected");
  });
  document.querySelectorAll(".arch-wires .wire, .arch-wires .wire-labels text").forEach((el) => {
    el.classList.remove("is-active", "is-done");
  });
}

function highlightStep(step, { accumulate = false } = {}) {
  if (!accumulate) clearHighlights();

  step.nodes.forEach((id) => {
    const el = document.querySelector(`.arch-node[data-node="${id}"]`);
    if (el) el.classList.add("is-active");
  });

  step.edges.forEach((id) => {
    document.querySelectorAll(`[data-edge="${id}"]`).forEach((el) => {
      el.classList.add("is-active");
    });
  });

  renderDetail(step.detail);
  $("arch-step-label").textContent = step.label;
}

function selectNode(nodeId) {
  stopPlayback();
  clearHighlights();
  const el = document.querySelector(`.arch-node[data-node="${nodeId}"]`);
  if (el) el.classList.add("is-selected", "is-active");
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
}

let playTimer = null;
let stepIndex = -1;
let playing = false;

function updateStepButton() {
  const stepBtn = $("arch-step");
  if (!stepBtn) return;
  stepBtn.disabled = playing || stepIndex >= FLOW.length - 1;
}

function stopPlayback() {
  playing = false;
  if (playTimer) {
    clearTimeout(playTimer);
    playTimer = null;
  }
  const playBtn = $("arch-play");
  if (playBtn) playBtn.textContent = "Play flow";
  updateStepButton();
}

function markVisitedUpTo(index) {
  for (let i = 0; i <= index; i += 1) {
    FLOW[i].nodes.forEach((id) => {
      const el = document.querySelector(`.arch-node[data-node="${id}"]`);
      if (el && i < index) el.classList.add("is-done");
    });
    FLOW[i].edges.forEach((id) => {
      document.querySelectorAll(`.wire[data-edge="${id}"]`).forEach((el) => {
        if (i < index) {
          el.classList.remove("is-active");
          el.classList.add("is-done");
        }
      });
    });
  }
}

function goToStep(index) {
  if (index < 0 || index >= FLOW.length) return;
  stepIndex = index;
  clearHighlights();
  markVisitedUpTo(index);
  highlightStep(FLOW[index], { accumulate: true });
  updateStepButton();
}

function playFlow() {
  if (playing) {
    stopPlayback();
    return;
  }
  playing = true;
  $("arch-play").textContent = "Pause";
  $("arch-step").disabled = true;

  const start = stepIndex < 0 || stepIndex >= FLOW.length - 1 ? 0 : stepIndex + 1;

  const tick = (i) => {
    if (!playing) return;
    if (i >= FLOW.length) {
      stopPlayback();
      $("arch-step-label").textContent = "Flow complete. Reset to play again.";
      $("arch-step").disabled = true;
      return;
    }
    goToStep(i);
    $("arch-play").textContent = "Pause";
    $("arch-step").disabled = true;
    playTimer = setTimeout(() => tick(i + 1), 1600);
  };

  tick(start);
}

function resetFlow() {
  stopPlayback();
  stepIndex = -1;
  clearHighlights();
  renderDetail(DEFAULT_DETAIL);
  $("arch-step-label").textContent = "Idle. Pick a node or press Play.";
  updateStepButton();
}

export function initArchitecture() {
  if (!$("arch-diagram")) return;

  document.querySelectorAll(".arch-node").forEach((btn) => {
    btn.addEventListener("click", () => selectNode(btn.dataset.node));
  });

  $("arch-play").addEventListener("click", playFlow);
  $("arch-step").addEventListener("click", () => {
    stopPlayback();
    goToStep(stepIndex < 0 ? 0 : stepIndex + 1);
  });
  $("arch-reset").addEventListener("click", resetFlow);

  renderDetail(DEFAULT_DETAIL);
  updateStepButton();
}
