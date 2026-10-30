/**
 * Foodtruck policy — the rules the admin assistant checks every proposal against.
 * Plain data so the rules can change without touching code elsewhere: when Gata &
 * trafik answers the questions in specs/admin-assistent.md (fas 0), edit this file
 * (bump `version`), run `pnpm test`, deploy.
 *
 * severity "stopp"   → the confirm card has no Bekräfta button
 * severity "varning" → the card shows the warning, the user decides
 */

export type PolicySeverity = "varning" | "stopp"

export type PolicyRule = {
  id: string
  severity: PolicySeverity
  text: string
}

export const POLICY = {
  version: "0 (2026-10-30) — dagens regler, i väntan på svar från Gata & trafik",
  owner: "Head of Foodtruck (ägaren utses i fas 0)",

  /** Pass for new spaces. Today every space has one whole-day pass. */
  slotTemplates: [
    { name: "Heldag", slots: [{ start: "10:00", end: "03:00", description: "Heldag" }] },
  ],

  rules: [
    { id: "past-date", severity: "stopp", text: "Datum som redan har passerat går inte att spärra." },
    { id: "block-no-effect", severity: "stopp", text: "Spärren träffar inget av platsens pass och skulle inte stoppa någon bokning. Välj hela dagen." },
    { id: "block-on-booking", severity: "varning", text: "Spärren läggs på en tid som redan är bokad. Bokningen ligger kvar (den avbokas inte), så kontakta foodtruckern." },
    { id: "slots-orphan-bookings", severity: "varning", text: "De nya passen passar inte alla kommande bokningar. Bokningarna ligger kvar med sina gamla tider." },
    { id: "slots-block-reach", severity: "varning", text: "Befintliga morgon- eller kvällsspärrar får en annan räckvidd med de nya passen." },
    { id: "slots-off-template", severity: "varning", text: "Passen avviker från mallen för nya platser." },
    { id: "delete-with-bookings", severity: "varning", text: "Foodtrucken har kommande bokningar. Inaktivera i stället om den kan komma tillbaka." },
  ] satisfies PolicyRule[],
} as const

export type PolicyRuleId = (typeof POLICY.rules)[number]["id"]

export function policyRule(id: PolicyRuleId): PolicyRule {
  return POLICY.rules.find((r) => r.id === id)!
}

/** The policy as text for the assistant's system prompt. */
export function policyText(): string {
  const tpl = POLICY.slotTemplates
    .map((t) => `${t.name}: ${t.slots.map((s) => `${s.start}–${s.end}`).join(" + ")}`)
    .join("; ")
  return [
    `Policy version ${POLICY.version}. Ägare: ${POLICY.owner}.`,
    `Passmall för nya platser: ${tpl}.`,
    ...POLICY.rules.map((r) => `- [${r.severity}] ${r.text}`),
  ].join("\n")
}
