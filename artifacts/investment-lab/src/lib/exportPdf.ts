import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";

export async function exportToPdf(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const isDark = document.documentElement.classList.contains("dark");

  if (isDark) {
    document.documentElement.classList.remove("dark");
  }

  // Temporarily reveal PDF-only blocks (e.g. full disclaimer) so they appear in the export
  const pdfOnlyEls = Array.from(
    element.querySelectorAll<HTMLElement>(".pdf-only")
  );
  pdfOnlyEls.forEach((el) => {
    el.dataset.prevDisplay = el.style.display;
    el.style.display = "block";
    el.classList.remove("hidden");
  });

  // Page-break handling: the whole report is rasterised to a single canvas
  // and then sliced at A4 boundaries, so CSS page-break-* rules don't
  // apply. To control where pages split we inject white spacers ahead of
  // certain elements, sized so the element lands at the top of the next
  // page. Two attributes drive this:
  //
  //   * data-pdf-page-break="before" — explicit "always start this on a
  //     fresh page" marker. Kept for backward compatibility with any
  //     consumer that needs forced pagination.
  //   * data-pdf-keep-together — "don't let this element be split across a
  //     page seam". A spacer is only injected when the element would
  //     actually straddle a page boundary AND fits on a single page on its
  //     own. Sections taller than one page are left to flow naturally so
  //     we never produce pages that are entirely whitespace.
  //
  // Spacers are removed in the finally block so the off-screen mount
  // returns to its pristine state.
  const PDF_PAGE_HEIGHT_MM = 297; // A4 portrait
  const PDF_PAGE_WIDTH_MM = 210;
  // Top inset applied to every page-break landing point. The off-screen
  // report container has padding-top: 12mm, but that padding is captured
  // into the canvas only ONCE (at the very top of page 1) — every
  // subsequent page slice begins flush against the next strip of content,
  // with zero whitespace above. Without this inset the page-break section
  // title would sit hard against the upper edge of the new PDF page,
  // breaking the visual rhythm established by page 1's header margin.
  // 12mm matches the container's own top padding for consistency.
  const PDF_PAGE_BREAK_TOP_INSET_MM = 12;
  const insertedSpacers: HTMLElement[] = [];
  // Collect both marker types in a single document-order pass so cascading
  // shifts from earlier insertions are reflected in later measurements.
  const breakNodes = Array.from(
    element.querySelectorAll<HTMLElement>(
      '[data-pdf-page-break="before"], [data-pdf-keep-together]',
    ),
  );

  try {
    // Give DOM a moment to reflow if theme changed
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (breakNodes.length > 0) {
      // CSS px per mm, derived from the *actual* rendered width of the
      // off-screen container (which is set to 210mm with box-sizing border-
      // box). This must match the px→mm ratio html2canvas+jsPDF will use
      // when sizing the slice, so the spacer aligns the marker exactly to
      // the page boundary.
      const pxPerMm = element.offsetWidth / PDF_PAGE_WIDTH_MM;
      for (const node of breakNodes) {
        // Re-measure each iteration: previously-inserted spacers shift the
        // position (and the height, if reflow rewrapped anything) of
        // subsequent nodes downward.
        const elTop = element.getBoundingClientRect().top;
        const rect = node.getBoundingClientRect();
        const nodeTopMm = (rect.top - elTop) / pxPerMm;
        const nodeHeightMm = rect.height / pxPerMm;
        const overshootMm = nodeTopMm % PDF_PAGE_HEIGHT_MM;
        // Already at (or within 1mm of) the top of a page — nothing to do.
        if (overshootMm < 1) continue;

        const isExplicit =
          node.getAttribute("data-pdf-page-break") === "before";
        if (!isExplicit) {
          // Keep-together pass: only break if this section would actually
          // be split across the page seam. If it fits in the remaining
          // space on the current page, leave it alone.
          const remainingOnPageMm = PDF_PAGE_HEIGHT_MM - overshootMm;
          if (nodeHeightMm <= remainingOnPageMm) continue;
          // If the section is taller than a single page on its own, no
          // amount of pushing will keep it together — let it flow
          // naturally instead of producing a near-empty page.
          if (nodeHeightMm > PDF_PAGE_HEIGHT_MM) continue;
        }

        // Pad to (next page top) + a fixed top inset, so the section title
        // gets visual breathing room instead of sitting hard against the
        // page edge. See PDF_PAGE_BREAK_TOP_INSET_MM comment above.
        const padMm =
          PDF_PAGE_HEIGHT_MM - overshootMm + PDF_PAGE_BREAK_TOP_INSET_MM;
        // Skip pads smaller than a content-line height to avoid awkward
        // slivers of whitespace.
        if (padMm < 3) continue;
        const padPx = padMm * pxPerMm;
        const spacer = document.createElement("div");
        spacer.setAttribute("aria-hidden", "true");
        spacer.style.cssText = `height:${padPx}px;width:100%;background:#ffffff;`;
        node.parentNode?.insertBefore(spacer, node);
        insertedSpacers.push(spacer);
      }
      // Allow the layout to settle before measuring for the canvas pass.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    // JPEG at q=0.92 is dramatically smaller than PNG (often 10×) for a
    // print-style report and the loss is invisible for typical use
    // (printing, sharing, email). Keep scale=2 so text stays crisp.
    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    // A4 dimensions in mm
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4"
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    
    const ratio = pdfWidth / imgWidth;
    const totalImgHeightInMm = imgHeight * ratio;

    // Tolerance for the single-page detection only (NOT applied to mid-
    // pagination). html2canvas can produce a height that is fractionally
    // larger than one A4 page due to sub-pixel rendering or borders; treat
    // anything within 2mm of a single page as fitting on one so we don't
    // emit a near-empty second page. For genuinely longer content, we slice
    // at the true page boundaries to avoid clipping content.
    const SINGLE_PAGE_TOLERANCE_MM = 2;

    // First page (always written)
    pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, totalImgHeightInMm);

    if (totalImgHeightInMm > pdfHeight + SINGLE_PAGE_TOLERANCE_MM) {
      // Multi-page slice pagination using true page boundaries.
      let heightLeft = totalImgHeightInMm - pdfHeight;
      while (heightLeft > 0) {
        const position = heightLeft - totalImgHeightInMm; // Shift image up
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, position, pdfWidth, totalImgHeightInMm);
        heightLeft -= pdfHeight;
      }
    }

    pdf.save(filename);
  } finally {
    // Tear down injected page-break spacers so the off-screen mount
    // returns to its pristine state for the next export pass.
    insertedSpacers.forEach((s) => s.remove());
    pdfOnlyEls.forEach((el) => {
      el.classList.add("hidden");
      el.style.display = el.dataset.prevDisplay ?? "";
      delete el.dataset.prevDisplay;
    });
    if (isDark) {
      document.documentElement.classList.add("dark");
    }
  }
}
