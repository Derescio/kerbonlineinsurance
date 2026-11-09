import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { renderWithRouter } from "#/test/router";

import type { UploadsTestPageData } from "./server";
import { UploadsTestPage } from "./UploadsTestPage";

// /dev/uploads (4.10) against mocked server functions: which claims take files, and a server
// refusal shown as its own sentence.

const fns = vi.hoisted(() => ({
  getUploadsTestPage: vi.fn(),
  createMyUpload: vi.fn(),
  confirmMyUpload: vi.fn(),
  openMyFile: vi.fn(),
  staffClaimFiles: vi.fn(),
  staffOpenFile: vi.fn(),
}));
vi.mock("./server", () => fns);

const data: UploadsTestPageData = {
  staff: false,
  claims: [
    { id: "c1", reference: "KRB-C-90001", status: "assessing", acceptsUploads: true, files: [] },
    { id: "c2", reference: "KRB-C-90002", status: "settled", acceptsUploads: false, files: [] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/dev/uploads", () => {
  it("offers Choose file on an open claim only", async () => {
    await renderWithRouter(<UploadsTestPage data={data} />);
    const open = page.getByRole("region", { name: /KRB-C-90001/ });
    const settled = page.getByRole("region", { name: /KRB-C-90002/ });
    await expect.element(open.getByRole("button", { name: "Choose file" })).toBeVisible();
    await expect.element(settled.getByText("This claim can't take new files.")).toBeVisible();
    expect(settled.getByRole("button", { name: "Choose file" }).elements()).toHaveLength(0);
  });

  it("sends a PDF as a claim document and shows the server's refusal", async () => {
    fns.createMyUpload.mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION", message: "This claim already has 5 documents.", fields: {} },
    });
    await renderWithRouter(<UploadsTestPage data={data} />);
    const pdf = new File(["%PDF-1.7\n"], "estimate.pdf", { type: "application/pdf" });
    await userEvent.upload(page.getByTestId("file-input-KRB-C-90001"), pdf);

    await expect.element(page.getByText("This claim already has 5 documents.")).toBeVisible();
    expect(fns.createMyUpload).toHaveBeenCalledWith({
      data: {
        kind: "claim_document",
        parentId: "c1",
        mime: "application/pdf",
        sizeBytes: pdf.size,
      },
    });
    expect(fns.confirmMyUpload).not.toHaveBeenCalled();
  });

  it("shows the staff box only to staff", async () => {
    await renderWithRouter(<UploadsTestPage data={{ ...data, staff: true }} />);
    await expect.element(page.getByRole("heading", { name: "Staff view" })).toBeVisible();
    await expect.element(page.getByLabelText("Claim reference")).toBeVisible();
  });
});
