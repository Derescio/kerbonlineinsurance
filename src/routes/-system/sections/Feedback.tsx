import { useState } from "react";

import { Button } from "#/components/actions/Button";
import { Alert } from "#/components/feedback/Alert";
import { Dialog } from "#/components/feedback/Dialog";
import { Toast } from "#/components/feedback/Toast";
import { useToast } from "#/components/feedback/Toaster";
import { Tooltip } from "#/components/feedback/Tooltip";

import { Block, Label, Section } from "../parts";

const tones = ["neutral", "info", "success", "warning", "danger"] as const;

const cancelCopy = {
  title: "Cancel your policy?",
  description: "You'll be covered until 11:59pm today. We'll refund the days you haven't used.",
};

export function Feedback() {
  const toast = useToast();
  const [open, setOpen] = useState<"modal" | "sheet" | null>(null);
  const close = () => setOpen(null);

  return (
    <Section
      id="feedback"
      intro="Alerts sit inline and persist; toasts confirm an action and auto-dismiss after 5s; tooltips explain jargon in under ~20 words; dialogs confirm destructive actions or hold a focused sub-task. No exclamation marks, no “Oops”."
    >
      <Block title="Alert">
        <div className="sys__grid">
          {tones.map((t) => (
            <Alert key={t} tone={t} title="Your policy renews in 12 days">
              Check your details are still right.
            </Alert>
          ))}
        </div>
      </Block>
      <Block title="Toast">
        <div className="sys__grid sys__grid--wide sys__block">
          {(["success", "info", "warning", "danger", "neutral"] as const).map((t) => (
            <Toast
              key={t}
              tone={t}
              title="Claim submitted"
              message="Reference KRB-C-20931"
              actionLabel="View"
              onAction={() => {}}
              onClose={() => {}}
            />
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            toast({ title: "Details saved", message: "We'll use them from your next quote." })
          }
        >
          Show a toast
        </Button>
      </Block>
      <Block title="Tooltip">
        <Label>Hover, focus or tap the underlined terms</Label>
        {/* Bubbles centre on their term, so keep terms away from the block's left edge */}
        <p className="kb-body" style={{ paddingTop: 56, paddingBottom: 48 }}>
          Your policy has an{" "}
          <Tooltip open content="The amount you pay towards any claim.">
            excess
          </Tooltip>{" "}
          of £250, and you have{" "}
          <Tooltip open placement="bottom" content="Years in a row without a claim.">
            no-claims discount
          </Tooltip>{" "}
          for 4 years.
        </p>
      </Block>
      <Block title="Dialog">
        <div className="sys__grid sys__grid--wide sys__block">
          {(["modal", "sheet"] as const).map((p) => (
            <div key={p}>
              <Label>{p} (preview)</Label>
              <div className="sys__dialog-stage">
                <Dialog
                  open
                  contained
                  presentation={p}
                  onClose={() => {}}
                  {...cancelCopy}
                  actions={
                    <>
                      <Button variant="ghost">Keep policy</Button>
                      <Button variant="danger">Cancel policy</Button>
                    </>
                  }
                />
              </div>
            </div>
          ))}
        </div>
        <div className="sys__row">
          <Button onClick={() => setOpen("modal")}>Open dialog</Button>
          <Button variant="secondary" onClick={() => setOpen("sheet")}>
            Open sheet
          </Button>
        </div>
        <Dialog
          open={open !== null}
          presentation={open ?? "modal"}
          onClose={close}
          {...cancelCopy}
          actions={
            <>
              <Button variant="ghost" onClick={close}>
                Keep policy
              </Button>
              <Button variant="danger" onClick={close}>
                Cancel policy
              </Button>
            </>
          }
        />
      </Block>
    </Section>
  );
}
