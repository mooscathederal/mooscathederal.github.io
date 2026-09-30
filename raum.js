// Der Raum unter jeder Ebene: Fische schwimmen weiter, im angeglichenen Waldlicht, unter dem Schleier.
import { startKoi } from "./animation/koi.js";
import { startWald } from "./animation/wald.js";

const waldCanvas = document.getElementById("wald-shader");
if (waldCanvas) {
  startWald(waldCanvas)
    .then(() => waldCanvas.classList.add("laeuft"))
    .catch(() => waldCanvas.remove());   // Rückfall: stehendes hintergrund.webp
}

const canvas = document.getElementById("koi");
if (canvas) {
  startKoi(canvas, { transparent: true, tint: [0.86, 0.9, 0.82] })
    .then(() => canvas.classList.add("laeuft"))
    .catch(() => canvas.remove());   // Rückfall: stehender Wald
}
