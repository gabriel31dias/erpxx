// arrastar com o mouse pra rolar listas horizontais (no touch o navegador já faz sozinho).
// uso: <div {...dragScroll}>. Se arrastou, engole o click pra não selecionar a pílula sem querer.
let start = null;

export const dragScroll = {
  onPointerDown(e) {
    if (e.pointerType !== 'mouse') return;
    start = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
  },
  onPointerMove(e) {
    if (!start || e.buttons !== 1) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > 4) start.moved = true;
    e.currentTarget.scrollLeft = start.left - dx;
  },
  onPointerUp() {
    // limpa depois do click, que dispara logo após o pointerup
    setTimeout(() => (start = null));
  },
  onClickCapture(e) {
    if (start?.moved) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  onPointerLeave() {
    if (start && !start.moved) start = null;
  },
};
