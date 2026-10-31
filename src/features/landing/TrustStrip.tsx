// Kerb is fictional, so nothing here may look like a real review score, customer count or regulator
// number (plan/README.md, working rules). The rating slot waits for real reviews (6.9).
const stats = [
  { value: "Reviews coming soon", caption: "Ratings from real Kerb customers will show here." },
  { value: "Fast claims", caption: "Average time to a claim decision" },
  { value: "7-day support", caption: "UK team, 7 days a week" },
];

/** Trust strip (Figma 54:1994 web, 103:5588 tablet, 103:5648 mobile). */
export function TrustStrip() {
  return (
    <section className="trust" aria-label="Kerb at a glance">
      <ul className="site-container trust__list">
        {stats.map((stat) => (
          <li key={stat.value} className="trust__stat">
            <p className="trust__value">{stat.value}</p>
            <p className="trust__caption">{stat.caption}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
