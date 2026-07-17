/** Canned playground responses for the demo patient (Danae Kshlerin). */

export const PATIENT = {
  id: "87a339d0-8cae-418e-89c7-8651e6aab3c6",
  name: "Danae Kshlerin",
  age: 61,
  gender: "female",
  fhirUrl: "https://r4.smarthealthit.org",
};

export const TOOLS = [
  {
    name: "SummarizePatient",
    usesLlm: false,
    description: "Name, birth date, gender, and age from the FHIR Patient resource.",
    argsSchema: {},
    demo: () => ({
      status: "success",
      patient_id: PATIENT.id,
      name: PATIENT.name,
      birth_date: "1964-08-12",
      age: PATIENT.age,
      gender: PATIENT.gender,
    }),
  },
  {
    name: "ListActiveConditions",
    usesLlm: false,
    description: "Active problem list with SNOMED and ICD-10 codes.",
    argsSchema: {},
    demo: () => ({
      status: "success",
      count: 2,
      conditions: [
        {
          display: "Type 2 diabetes mellitus",
          snomed: "44054006",
          icd10: "E11",
          clinical_status: "active",
        },
        {
          display: "Essential hypertension",
          snomed: "38341003",
          icd10: "I10",
          clinical_status: "active",
        },
      ],
    }),
  },
  {
    name: "ListRecentObservations",
    usesLlm: false,
    description: "Labs, vitals, and screening procedures from the last N months.",
    argsSchema: { months_back: 24 },
    demo: (args) => ({
      status: "success",
      months_back: Number(args.months_back) || 24,
      count: 1,
      observations: [
        {
          display: "Body Weight",
          loinc: "29463-7",
          value: "78.4 kg",
          date: "2024-11-03",
        },
      ],
      note: "No HbA1c (LOINC 4548-4) in this window. That triggers diabetes-a1c-overdue.",
    }),
  },
  {
    name: "FindCareGaps",
    usesLlm: true,
    description: "YAML rules flag overdue screenings. Gemini writes a one-sentence clinical rationale for each gap.",
    argsSchema: {},
    demo: () => ({
      status: "success",
      patient_age: PATIENT.age,
      patient_gender: PATIENT.gender,
      gap_count: 3,
      gaps: [
        {
          id: "diabetes-a1c-overdue",
          title: "HbA1c overdue",
          severity: "high",
          uspstf_grade: "B",
          evidence: {
            condition: "Type 2 diabetes mellitus (E11 / 44054006)",
            last_observation: "2020-11-18",
            months_since: 65.8,
            threshold_months: 6,
          },
          rationale:
            "She has long-standing type 2 diabetes. More than 5 years without an A1c raises the risk of missed glycemic deterioration.",
        },
        {
          id: "colorectal-screening-overdue",
          title: "Colorectal screening overdue",
          severity: "medium",
          uspstf_grade: "A",
          evidence: { age_in_range: true, procedures_found: 0 },
          rationale:
            "At age 61 she is in the screening window. There is no colonoscopy or FIT on file.",
        },
        {
          id: "mammography-overdue",
          title: "Mammography overdue",
          severity: "medium",
          uspstf_grade: "B",
          evidence: { age_in_range: true, sex: "female", procedures_found: 0 },
          rationale:
            "No mammogram on record for a 61-year-old woman. USPSTF guidance treats that as overdue.",
        },
      ],
    }),
  },
  {
    name: "GetPatientRiskSummary",
    usesLlm: false,
    description: "Counts gaps by severity and returns a risk_level. Skips the per-gap rationale.",
    argsSchema: {},
    demo: () => ({
      status: "success",
      risk_level: "high",
      total_gaps: 3,
      by_severity: { high: 1, medium: 2, low: 0 },
    }),
  },
  {
    name: "DraftOutreachMessage",
    usesLlm: true,
    description: "Gemini drafts SMS or portal copy for one gap, aimed at about a sixth-grade reading level.",
    argsSchema: {
      gap: {
        id: "diabetes-a1c-overdue",
        title: "HbA1c overdue",
        severity: "high",
      },
      patient_name: "Danae",
      channel: "sms",
    },
    demo: (args) => {
      const channel = args.channel || "sms";
      const sms =
        "Hi Danae, your last A1c blood test was a while back. A quick check-in helps us keep your diabetes on track. Call us at the clinic when you can, and we'll find a time that works.";
      const portal =
        "Hi Danae,\n\nOur records show it has been several years since your last A1c blood test. This test helps us see how your diabetes is doing over time.\n\nPlease call the clinic when you can so we can schedule a time that works.";
      return {
        status: "success",
        channel,
        gap_id: args.gap?.id || "diabetes-a1c-overdue",
        message: channel === "portal" ? portal : sms,
        character_count: channel === "portal" ? portal.length : sms.length,
      };
    },
  },
];

export const DEMO_PROMPTS = [
  "What preventive care gaps does this patient have?",
  "How urgent is this patient?",
  "Draft an SMS about the A1c.",
];

export function demoAgentReply(text) {
  const q = text.toLowerCase();
  if (q.includes("urgent") || q.includes("risk")) {
    return {
      delayMs: 700,
      text:
        "Risk summary for Danae Kshlerin (61F):\n" +
        "• Overall risk level: high\n" +
        "• Open gaps: 3 (1 high, 2 medium)\n\n" +
        "The high-severity item is the overdue HbA1c. I can pull the full evidence or draft outreach.",
    };
  }
  if (q.includes("sms") || q.includes("draft") || q.includes("outreach") || q.includes("portal")) {
    return {
      delayMs: 900,
      text:
        "SMS for the HbA1c gap (under 160 characters):\n\n" +
        "\"Hi Danae, your last A1c blood test was a while back. A quick check-in helps us keep your diabetes on track. Call us at the clinic when you can, and we'll find a time that works.\"\n\n" +
        "I can also write a patient-portal version.",
    };
  }
  return {
    delayMs: 1100,
    text:
      "For Danae Kshlerin (61F):\n" +
      "• HbA1c overdue. Last A1c was 65.8 months ago (Nov 2020). She has long-standing type 2 diabetes. More than 5 years without monitoring raises the risk of missed glycemic deterioration.\n" +
      "• Colorectal screening overdue. Nothing on file.\n" +
      "• Mammography overdue. Nothing on file.\n\n" +
      "I can draft outreach for any of these.",
  };
}
