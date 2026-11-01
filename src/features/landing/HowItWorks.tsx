import photo from "#/assets/how-it-works-laptop.jpg?w=480;768;1120&format=avif;webp;jpg&as=picture";
import { Icon } from "#/components/display/Icon";
import { quoteHref } from "#/components/site/links";

import { ButtonLink } from "./ButtonLink";
import { ResponsiveImage } from "./ResponsiveImage";

const steps = [
  { title: "Get a quote", body: "Enter your postcode. It takes about two minutes." },
  { title: "Review and choose your cover", body: "See your price, excess and optional extras." },
  {
    title: "Purchase and manage your policy",
    body: "Pay monthly or annually, then access your policy online.",
  },
];

// 600px of the 1152 container on web, about half on tablet, full width on mobile
const sizes = "(min-width: 1200px) 600px, (min-width: 768px) 46vw, 100vw";

/** How it works (Figma 54:2008 web, 103:5611 tablet, 103:5671 mobile). */
export function HowItWorks() {
  return (
    <section className="how" aria-labelledby="how-title">
      <div className="site-container how__grid">
        <ResponsiveImage picture={photo} sizes={sizes} className="how__photo" loading="lazy" />
        <div className="how__content">
          <div className="landing-heading">
            <p className="landing-heading__overline">How it works</p>
            <h2 className="landing-heading__title how__title" id="how-title">
              From quote to covered in minutes
            </h2>
          </div>
          <ol className="how__steps">
            {steps.map((step) => (
              <li key={step.title} className="how__step">
                <span className="how__check">
                  <Icon name="check" size={24} />
                </span>
                <span className="how__text">
                  <span className="how__step-title">{step.title}</span>
                  <span className="how__step-body">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
          <ButtonLink href={quoteHref} variant="primary" size="sm" className="how__cta">
            Get a quote
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
