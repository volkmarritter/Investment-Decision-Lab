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

  try {
    // Give DOM a moment to reflow if theme changed
    await new Promise((resolve) => setTimeout(resolve, 100));

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
