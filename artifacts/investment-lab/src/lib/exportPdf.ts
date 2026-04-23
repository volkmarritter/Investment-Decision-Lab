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

    const imgData = canvas.toDataURL("image/png");
    
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

    let heightLeft = totalImgHeightInMm;
    let position = 0;

    // First page
    pdf.addImage(imgData, "PNG", 0, position, pdfWidth, totalImgHeightInMm);
    heightLeft -= pdfHeight;

    // Subsequent pages
    while (heightLeft > 0) {
      position = heightLeft - totalImgHeightInMm; // Shift image up
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, pdfWidth, totalImgHeightInMm);
      heightLeft -= pdfHeight;
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
