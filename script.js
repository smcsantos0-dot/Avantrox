document.addEventListener("DOMContentLoaded", () => {

    // INICIALIZAÇÃO AVANTROX

    console.log("AVANTROX iniciado com sucesso!");

    // ANIMAÇÃO DAS CLASSES

    const cards = document.querySelectorAll(".class-card");

    const observer = new IntersectionObserver((entries) => {

        entries.forEach(entry => {

            if (entry.isIntersecting) {

                entry.target.classList.add("visible");

                observer.unobserve(entry.target);

            }

        });

    }, {
        threshold: 0.2
    });

    cards.forEach(card => {

        observer.observe(card);

    });

});
