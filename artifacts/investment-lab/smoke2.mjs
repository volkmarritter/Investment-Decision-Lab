import PptxModule from "pptxgenjs";
console.log("typeof default:", typeof PptxModule, "keys:", Object.keys(PptxModule || {}).slice(0,5));
const P = PptxModule.default || PptxModule;
console.log("typeof P:", typeof P, "is fn:", typeof P === "function");
