(function () {
  "use strict";

  var firstStep = 1;
  var finalStep = 4;
  var currentStep = firstStep;
  var startButton = document.getElementById("demo-start");
  var backButton = document.getElementById("demo-back");
  var nextButton = document.getElementById("demo-next");
  var replayButton = document.getElementById("demo-replay");
  var position = document.getElementById("demo-position");
  var progress = document.getElementById("story-progress");
  var evidence = document.getElementById("demo-evidence");
  var nextLabels = {
    1: "See the first job's outcome",
    2: "See how the other jobs ended",
    3: "See the actual withdrawals",
    4: "Inspect the records"
  };

  function reducedMotion() {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function focusHeading(step) {
    var heading = document.getElementById("step-" + step + "-title");
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function goTo(step, options) {
    currentStep = Math.max(firstStep, Math.min(finalStep, step));
    for (var index = firstStep; index <= finalStep; index += 1) {
      var panel = document.getElementById("story-step-" + index);
      panel.hidden = index !== currentStep;
      panel.classList.toggle("active", index === currentStep);
    }
    for (var marker = 0; marker < progress.children.length; marker += 1) {
      if (marker + 1 === currentStep) progress.children[marker].setAttribute("aria-current", "step");
      else progress.children[marker].removeAttribute("aria-current");
    }
    backButton.disabled = currentStep === firstStep;
    nextButton.textContent = nextLabels[currentStep];
    replayButton.hidden = currentStep !== finalStep;
    position.textContent = "Step " + currentStep + " of 4 · Recorded testnet";
    if (!options || !options.preserveFocus) focusHeading(currentStep);
  }

  startButton.addEventListener("click", function () {
    goTo(firstStep);
  });
  backButton.addEventListener("click", function () { goTo(currentStep - 1); });
  nextButton.addEventListener("click", function () {
    if (currentStep === finalStep) {
      evidence.open = true;
      evidence.querySelector("summary").focus();
      return;
    }
    goTo(currentStep + 1);
  });
  replayButton.addEventListener("click", function () { goTo(firstStep); });
  document.addEventListener("keydown", function (event) {
    if (event.target.closest("a, button, summary, input, textarea")) return;
    if (event.key === "ArrowRight") goTo(currentStep + 1);
    if (event.key === "ArrowLeft") goTo(currentStep - 1);
  });
  goTo(firstStep, { preserveFocus: true });
})();
