
document.addEventListener("DOMContentLoaded", () => {
  const buttons = document.querySelectorAll(".button");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      btn.classList.add("animate");

      btn.addEventListener("animationend", () => {
        btn.classList.remove("animate");
      }, { once: true });
    });
  });
});
