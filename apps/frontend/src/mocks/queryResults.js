// Mocked shape for the eventual AI pipeline response (answer +
// citations). This is a GUESS based on the project brief, not a
// confirmed contract — confirm with Jnani/backend before v0.3
// integration, and update this file to match reality then.

// A small bank of canned Q&A pairs so the search demo feels real
// instead of returning the same answer for every query.
const QA_BANK = [
  {
    keywords: ["travel", "hotel", "reimburs"],
    answer:
      "The Q3 travel reimbursement policy caps domestic hotel spend at ₹4,500/night, with pre-approval required above that threshold.",
    sources: [
      {
        id: "src-1",
        filename: "HR_Travel_Policy_2026.pdf",
        page: 12,
        excerpt:
          "Domestic accommodation shall not exceed ₹4,500 per night without prior written approval from the reporting manager.",
      },
      {
        id: "src-2",
        filename: "Finance_Reimbursement_Handbook.docx",
        page: 4,
        excerpt:
          "All travel exceeding standard caps must be routed through the Finance approval workflow before booking.",
      },
    ],
  },
  {
    keywords: ["leave", "vacation", "pto", "off"],
    answer:
      "Employees accrue 1.5 days of paid leave per month, capped at 24 days/year, with unused leave carrying over up to a maximum of 10 days.",
    sources: [
      {
        id: "src-3",
        filename: "HR_Leave_Policy_2026.pdf",
        page: 3,
        excerpt:
          "Paid leave accrues at a rate of 1.5 days per completed month of service, up to an annual maximum of 24 days.",
      },
    ],
  },
  {
    keywords: ["onboard", "new hire", "joining"],
    answer:
      "New hires complete a 3-day onboarding covering IT setup, compliance training, and a department-specific orientation led by their manager.",
    sources: [
      {
        id: "src-4",
        filename: "Onboarding_Handbook.pdf",
        page: 1,
        excerpt:
          "The onboarding schedule spans three working days: Day 1 IT and access setup, Day 2 compliance training, Day 3 department orientation.",
      },
      {
        id: "src-5",
        filename: "IT_Access_Checklist.xlsx",
        page: 1,
        excerpt:
          "All new hire accounts must be provisioned with least-privilege access aligned to their assigned department and role.",
      },
    ],
  },
];

const DEFAULT_RESULT = {
  answer:
    "I couldn't find a confident match in the connected knowledge base for that query. Try rephrasing, or narrow it to a specific policy or document.",
  sources: [],
};

/**
 * MOCK query function — simulates the future AI pipeline call with
 * fake latency. Swap the body for a real POST to the backend once
 * v0.3 lands; keep the return shape identical so callers don't change.
 */
export function askEkip(query) {
  const lower = query.toLowerCase();
  const match = QA_BANK.find((qa) =>
    qa.keywords.some((kw) => lower.includes(kw))
  );
  const result = match
    ? { answer: match.answer, sources: match.sources }
    : DEFAULT_RESULT;

  return new Promise((resolve) => {
    setTimeout(() => resolve(result), 700 + Math.random() * 500);
  });
}

export const mockQueryResult = {
  answer: QA_BANK[0].answer,
  sources: QA_BANK[0].sources,
};

export const mockUsers = [
  { id: "u1", name: "Aleena Thomas", role: "Admin", department: "IT" },
  { id: "u2", name: "Rahul Menon", role: "Manager", department: "Finance" },
  { id: "u3", name: "Sara Iqbal", role: "Employee", department: "HR" },
  { id: "u4", name: "Devan Nair", role: "Intern", department: "IT" },
];

export const mockDocuments = [
  { id: "d1", name: "HR_Travel_Policy_2026.pdf", uploadedBy: "Aleena Thomas", date: "2026-07-02", status: "Indexed" },
  { id: "d2", name: "Finance_Reimbursement_Handbook.docx", uploadedBy: "Rahul Menon", date: "2026-07-10", status: "Indexed" },
  { id: "d3", name: "Onboarding_Handbook.pdf", uploadedBy: "Aleena Thomas", date: "2026-08-01", status: "Processing" },
  { id: "d4", name: "IT_Access_Checklist.xlsx", uploadedBy: "Sara Iqbal", date: "2026-08-05", status: "Indexed" },
];
