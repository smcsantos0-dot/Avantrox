
"use strict";

// ==========================================
// INICIALIZAÇÃO AVANTROX
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    console.log("AVANTROX iniciado com sucesso!");

    const cards = document.querySelectorAll(".class-card");

    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("visible");
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.2 });

        cards.forEach(card => observer.observe(card));
    } else {
        cards.forEach(card => card.classList.add("visible"));
    }
});


// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

async function avantroxRequest(url, options = {}) {
    let response;

    try {
        response = await fetch(url, {
            credentials: "same-origin",
            ...options
        });
    } catch {
        throw new Error("Não foi possível conectar ao servidor.");
    }

    let data;

    try {
        data = await response.json();
    } catch {
        throw new Error(
            response.ok
                ? "O servidor retornou dados inválidos."
                : `Erro do servidor (${response.status}).`
        );
    }

    if (!response.ok) {
        const error = new Error(
            data.error ||
            data.message ||
            `Erro na solicitação (${response.status}).`
        );

        error.status = response.status;
        throw error;
    }

    return data;
}

function avantroxNumber(value) {
    return Number(value).toLocaleString("pt-BR");
}

function avantroxSetText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = String(value);
    }
}


// ==========================================
// LOGIN - AVANTROX
// ==========================================

(() => {
    const form = document.getElementById("loginForm");

    if (!form) return;

    const identifierInput =
        document.getElementById("loginIdentifier");

    const passwordInput =
        document.getElementById("loginPassword");

    const message =
        document.getElementById("loginMessage");

    const button =
        form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async event => {
        event.preventDefault();

        if (!form.reportValidity()) return;

        const identifier = identifierInput.value.trim();
        const password = passwordInput.value;

        button.disabled = true;
        button.textContent = "ENTRANDO...";

        if (message) {
            message.textContent = "Verificando sua conta...";
        }

        try {
            await avantroxRequest("/api/auth/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    identifier,
                    password
                })
            });

            if (message) {
                message.textContent =
                    "Login realizado com sucesso!";
            }

            window.location.href = "perfil.html";

        } catch (error) {
            if (message) {
                message.textContent =
                    error.message ||
                    "Nick, e-mail ou senha incorretos.";
            }

        } finally {
            button.disabled = false;
            button.textContent = "ENTRAR NO AVANTROX";
        }
    });
})();


// ==========================================
// CADASTRO - AVANTROX
// ==========================================

(() => {
    const form = document.getElementById("registerForm");

    if (!form) return;

    const usernameInput =
        document.getElementById("username");

    const emailInput =
        document.getElementById("email");

    const passwordInput =
        document.getElementById("password");

    const confirmPasswordInput =
        document.getElementById("confirmPassword");

    const message =
        document.getElementById("registerMessage");

    const button =
        form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async event => {
        event.preventDefault();

        if (!form.reportValidity()) return;

        const username = usernameInput.value.trim();
        const email = emailInput.value.trim();
        const playerClass = document.getElementById("playerClass").value;
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (username.length < 3 || username.length > 20) {
            message.textContent =
                "O nick deve ter entre 3 e 20 caracteres.";
            return;
        }

        if (password.length < 8) {
            message.textContent =
                "A senha precisa ter pelo menos 8 caracteres.";
            return;
        }

        if (password !== confirmPassword) {
            message.textContent =
                "As senhas não coincidem.";
            return;
        }

        button.disabled = true;
        button.textContent = "CRIANDO CONTA...";
        message.textContent = "Cadastrando jogador...";

        try {
            await avantroxRequest("/api/auth/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username,
                    email,
                    password,
                    playerClass
                })
            });

            message.textContent =
                "Conta criada com sucesso!";

            window.location.href = "perfil.html";

        } catch (error) {
            message.textContent =
                error.message ||
                "Não foi possível criar a conta.";

        } finally {
            button.disabled = false;
            button.textContent = "CRIAR CONTA";
        }
    });
})();


// ==========================================
// PERFIL E PROGRESSÃO DO JOGADOR
// ==========================================

(() => {
    const usernameElement =
        document.getElementById("profileUsername");

    if (!usernameElement) return;

    const classDescriptions = {
        Guerreiro:
            "Especialista em combate e resistência.",

        Mago:
            "Domina poderes mágicos e energias arcanas.",

        Assassino:
            "Especialista em agilidade, furtividade e precisão.",

        Paladino:
            "Combina resistência, proteção e poderes sagrados.",

        Arqueiro:
            "Especialista em ataques à distância, precisão e mobilidade.",

        Invocador:
            "Convoca aliados místicos e controla o campo de batalha.",

        Ceifador:
            "Classe secreta que domina técnicas sombrias."
    };

    async function loadPlayerProfile() {
        try {
            const account = await avantroxRequest(
                "/api/auth/me",
                {
                    method: "GET",
                    cache: "no-store"
                }
            );

            const player = account.user || account;

            const progression = await avantroxRequest(
                "/api/player/progression",
                {
                    method: "GET",
                    cache: "no-store"
                }
            );

            const username =
                player.username || "Aventureiro";

            const email =
                player.email || "";

            const playerClass =
                player.player_class || "Guerreiro";

            const level = Number(progression.level);
            const xp = Number(progression.xp);
            const xpNeeded = Number(progression.xpNeeded);
            const progress = Number(progression.progress);

            if (
                !Number.isFinite(level) ||
                !Number.isFinite(xp) ||
                !Number.isFinite(xpNeeded) ||
                !Number.isFinite(progress)
            ) {
                throw new Error(
                    "Os dados de progressão são inválidos."
                );
            }

            avantroxSetText(
                "profileUsername",
                username
            );

            avantroxSetText(
                "profileEmail",
                email
            );

            avantroxSetText(
                "profileClass",
                playerClass
            );

            avantroxSetText(
                "profileLevel",
                level
            );

            avantroxSetText(
                "profileXP",
                avantroxNumber(xp)
            );

            avantroxSetText(
                "profileNextXP",
                avantroxNumber(xpNeeded)
            );

            avantroxSetText(
                "profileXPRemaining",
                avantroxNumber(Math.max(0, xpNeeded - xp))
            );

            avantroxSetText(
                "profileClassLevel",
                level
            );

            avantroxSetText(
                "profileClassDescription",
                classDescriptions[playerClass] ||
                "Uma jornada aguarda por você."
            );

            avantroxSetText(
                "statLevel",
                level
            );

            avantroxSetText(
                "statClass",
                playerClass
            );

            avantroxSetText(
                "statXP",
                avantroxNumber(xp) + " XP"
            );

            const progressElement =
                document.getElementById(
                    "profileXPProgress"
                );

            if (progressElement) {
                const percentage = Math.min(
                    100,
                    Math.max(0, progress)
                );

                progressElement.style.width =
                    percentage + "%";

                progressElement.setAttribute(
                    "aria-valuenow",
                    String(percentage)
                );
            }

            console.log(
                "Perfil AVANTROX atualizado!",
                {
                    username,
                    playerClass,
                    level,
                    xp,
                    xpNeeded,
                    progress
                }
            );

        } catch (error) {
            if (error.status === 401) {
                window.location.href = "login.html";
                return;
            }

            console.error(
                "Erro ao carregar perfil:",
                error
            );

            usernameElement.textContent =
                "Erro ao carregar perfil";

            avantroxSetText(
                "profileEmail",
                "Atualize a página e tente novamente."
            );
        }
    }

    loadPlayerProfile();

    // Permite atualizar o perfil após
    // alguma ação que modifique a progressão.
    window.avantroxRefreshProfile =
        loadPlayerProfile;
})();


// ==========================================
// MISSÕES DO AVANTROX
// ==========================================

(() => {
    const missionsList =
        document.getElementById("missionsList");

    if (!missionsList) return;

    const counter =
        document.getElementById("missionsCounter");

    const progressFill =
        document.getElementById("missionsProgressFill");

    const message =
        document.getElementById("missionsMessage");

    const refreshButton =
        document.getElementById(
            "refreshMissionsButton"
        );

    function createMissionCard(mission) {
        const card = document.createElement("article");

        card.className = "mission-card";

        if (mission.completed) {
            card.classList.add("mission-completed");
        }

        const top = document.createElement("div");
        top.className = "mission-card-top";

        const icon = document.createElement("span");
        icon.className = "mission-icon";
        icon.textContent =
            mission.completed ? "✓" : "✦";

        icon.setAttribute(
            "aria-hidden",
            "true"
        );

        const status = document.createElement("span");
        status.className = "mission-status";

        status.textContent =
            mission.completed
                ? "CONCLUÍDA"
                : "PENDENTE";

        top.append(icon, status);

        const title = document.createElement("h3");
        title.textContent =
            mission.name || "Missão desconhecida";

        const description =
            document.createElement("p");

        description.textContent =
            mission.description || "";

        const reward =
            document.createElement("div");

        reward.className = "mission-reward";

        const xp = Number(mission.xp);

        reward.textContent =
            "✧ +" +
            avantroxNumber(
                Number.isFinite(xp) ? xp : 0
            ) +
            " XP";

        card.append(
            top,
            title,
            description,
            reward
        );

        return card;
    }

    async function loadMissions() {
        if (refreshButton) {
            refreshButton.disabled = true;
            refreshButton.textContent =
                "ATUALIZANDO...";
        }

        if (message) {
            message.textContent =
                "Carregando missões...";
        }

        try {
            const data = await avantroxRequest(
                "/api/player/missions",
                {
                    method: "GET",
                    cache: "no-store"
                }
            );

            if (
                data.success !== true ||
                !Array.isArray(data.missions)
            ) {
                throw new Error(
                    "O servidor retornou missões inválidas."
                );
            }

            const missions = data.missions;

            const completed = missions.filter(
                mission => mission.completed === true
            ).length;

            const total = missions.length;

            const percentage = total > 0
                ? Math.round(
                    (completed / total) * 100
                )
                : 0;

            if (counter) {
                counter.textContent =
                    `${completed} / ${total}`;
            }

            if (progressFill) {
                progressFill.style.width =
                    percentage + "%";

                progressFill.setAttribute(
                    "role",
                    "progressbar"
                );

                progressFill.setAttribute(
                    "aria-label",
                    "Progresso das missões"
                );

                progressFill.setAttribute(
                    "aria-valuemin",
                    "0"
                );

                progressFill.setAttribute(
                    "aria-valuemax",
                    "100"
                );

                progressFill.setAttribute(
                    "aria-valuenow",
                    String(percentage)
                );
            }

            missionsList.replaceChildren();

            if (total === 0) {
                const empty =
                    document.createElement("p");

                empty.textContent =
                    "Nenhuma missão disponível no momento.";

                missionsList.appendChild(empty);
            }

            missions.forEach(mission => {
                missionsList.appendChild(
                    createMissionCard(mission)
                );
            });

            if (message) {
                message.textContent =
                    completed === total && total > 0
                        ? "Todas as missões disponíveis foram concluídas!"
                        : `${completed} de ${total} missões concluídas.`;
            }

        } catch (error) {
            if (error.status === 401) {
                window.location.href = "login.html";
                return;
            }

            console.error(
                "Erro ao carregar missões:",
                error
            );

            if (message) {
                message.textContent =
                    error.message ||
                    "Não foi possível carregar as missões.";
            }

        } finally {
            if (refreshButton) {
                refreshButton.disabled = false;
                refreshButton.textContent =
                    "ATUALIZAR MISSÕES";
            }
        }
    }

    if (refreshButton) {
        refreshButton.addEventListener(
            "click",
            async () => {
                await loadMissions();

                if (
                    typeof window.avantroxRefreshProfile
                    === "function"
                ) {
                    await window.avantroxRefreshProfile();
                }
            }
        );
    }

    // Aguarda a progressão ser consultada antes
    // de mostrar o estado final das missões.
    loadMissions();
})();


// ==========================================
// SAIR DA CONTA
// ==========================================

(() => {
    const logoutButton =
        document.getElementById("logoutButton");

    if (!logoutButton) return;

    logoutButton.addEventListener(
        "click",
        async () => {
            logoutButton.disabled = true;
            logoutButton.textContent = "SAINDO...";

            try {
                await avantroxRequest(
                    "/api/auth/logout",
                    {
                        method: "POST"
                    }
                );

                window.location.href = "login.html";

            } catch (error) {
                console.error(
                    "Erro ao sair:",
                    error
                );

                logoutButton.disabled = false;
                logoutButton.textContent = "Sair";

                alert(
                    "Não foi possível sair da conta. Tente novamente."
                );
            }
        }
    );
})();


// ==========================================
// AVATAR DO JOGADOR
// ==========================================

(() => {
    const avatarInput =
        document.getElementById("avatarInput");

    const profileAvatar =
        document.getElementById("profileAvatar");

    if (!avatarInput || !profileAvatar) return;

    let previousAvatarURL = null;

    avatarInput.addEventListener(
        "change",
        () => {
            const file = avatarInput.files[0];

            if (!file) return;

            const allowedTypes = [
                "image/png",
                "image/jpeg",
                "image/webp"
            ];

            if (!allowedTypes.includes(file.type)) {
                alert(
                    "Selecione uma imagem PNG, JPG ou WEBP."
                );

                avatarInput.value = "";
                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                alert(
                    "A imagem deve ter no máximo 5 MB."
                );

                avatarInput.value = "";
                return;
            }

            if (previousAvatarURL) {
                URL.revokeObjectURL(
                    previousAvatarURL
                );
            }

            previousAvatarURL =
                URL.createObjectURL(file);

            profileAvatar.src =
                previousAvatarURL;
        }
    );
})();


// ==========================================
// ALTERAR NICK DO JOGADOR
// ==========================================

(() => {
    const form =
        document.getElementById(
            "changeUsernameForm"
        );

    if (!form) return;

    const input =
        document.getElementById("newUsername");

    const message =
        document.getElementById(
            "usernameMessage"
        );

    const button =
        form.querySelector('button[type="submit"]');

    form.addEventListener(
        "submit",
        async event => {
            event.preventDefault();

            if (!form.reportValidity()) return;

            const username = input.value.trim();

            if (
                username.length < 3 ||
                username.length > 20
            ) {
                message.textContent =
                    "O nick deve ter entre 3 e 20 caracteres.";
                return;
            }

            button.disabled = true;

            message.textContent =
                "Salvando novo nick...";

            try {
                await avantroxRequest(
                    "/api/profile/username",
                    {
                        method: "PUT",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            username
                        })
                    }
                );

                avantroxSetText(
                    "profileUsername",
                    username
                );

                message.textContent =
                    "Nick alterado com sucesso!";

                input.value = "";

            } catch (error) {
                message.textContent =
                    error.message ||
                    "Não foi possível alterar o nick.";

            } finally {
                button.disabled = false;
            }
        }
    );
})();


// ==========================================
// ALTERAÇÃO DE E-MAIL
// ==========================================

(() => {
    const form =
        document.getElementById(
            "changeEmailForm"
        );

    const verifyForm =
        document.getElementById(
            "verifyEmailForm"
        );

    if (!form || !verifyForm) return;

    const emailInput =
        document.getElementById("newEmail");

    const codeInput =
        document.getElementById(
            "emailVerificationCode"
        );

    const emailMessage =
        document.getElementById(
            "emailMessage"
        );

    const verificationMessage =
        document.getElementById(
            "verificationMessage"
        );

    let pendingNewEmail = "";

    form.addEventListener(
        "submit",
        async event => {
            event.preventDefault();

            if (!form.reportValidity()) return;

            const newEmail =
                emailInput.value.trim();

            const button =
                form.querySelector(
                    'button[type="submit"]'
                );

            button.disabled = true;

            emailMessage.textContent =
                "Solicitando código...";

            try {
                await avantroxRequest(
                    "/api/profile/email/request-code",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            email: newEmail
                        })
                    }
                );

                pendingNewEmail = newEmail;

                verifyForm.hidden = false;

                emailMessage.textContent =
                    "Solicitação realizada. Confira seu novo e-mail.";

            } catch (error) {
                emailMessage.textContent =
                    error.message ||
                    "Não foi possível solicitar o código.";

            } finally {
                button.disabled = false;
            }
        }
    );

    verifyForm.addEventListener(
        "submit",
        async event => {
            event.preventDefault();

            if (!verifyForm.reportValidity()) return;

            const code =
                codeInput.value.trim();

            if (!pendingNewEmail || !code) {
                verificationMessage.textContent =
                    "Informe o código de confirmação.";
                return;
            }

            const button =
                verifyForm.querySelector(
                    'button[type="submit"]'
                );

            button.disabled = true;

            verificationMessage.textContent =
                "Verificando código...";

            try {
                await avantroxRequest(
                    "/api/profile/email/verify-code",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            email: pendingNewEmail,
                            code
                        })
                    }
                );

                avantroxSetText(
                    "profileEmail",
                    pendingNewEmail
                );

                verificationMessage.textContent =
                    "E-mail alterado com sucesso!";

                emailInput.value = "";
                codeInput.value = "";

                pendingNewEmail = "";
                verifyForm.hidden = true;

            } catch (error) {
                verificationMessage.textContent =
                    error.message ||
                    "Código inválido ou expirado.";

            } finally {
                button.disabled = false;
            }
        }
    );
})();




// ==========================================
// LOJA DE ITENS - AVANTROX
// ==========================================

(() => {
    if (!document.querySelector(".shop-page")) return;

    const balanceElement = document.getElementById("coinBalance");
    const messageElement = document.getElementById("shopMessage");
    const inventoryElement = document.getElementById("inventoryList");
    const buyButtons = [...document.querySelectorAll(".buy-button")];
    let authenticated = false;
    let busy = false;

    function message(text) {
        if (messageElement) messageElement.textContent = text;
    }
    function render(data) {
        if (balanceElement) balanceElement.textContent =
            Number(data.astras).toLocaleString("pt-BR");
        if (!inventoryElement) return;
        inventoryElement.replaceChildren();
        const items = Array.isArray(data.inventory) ? data.inventory : [];
        if (!items.length) {
            const li = document.createElement("li");
            li.textContent = "Você ainda não comprou itens.";
            inventoryElement.appendChild(li);
        }
        for (const item of items) {
            const li = document.createElement("li");
            li.textContent = `${item.name} ×${item.quantity}`;
            inventoryElement.appendChild(li);
        }
    }
    function buttonsState() {
        for (const button of buyButtons) {
            button.disabled = !authenticated || busy;
            button.textContent = authenticated ? "Comprar" : "Entrar para comprar";
        }
    }
    document.querySelectorAll(".category-button").forEach(button => {
        button.addEventListener("click", () => {
            document.querySelectorAll(".category-button").forEach(b =>
                b.classList.toggle("active", b === button));
            document.querySelectorAll(".shop-item").forEach(item => {
                item.classList.toggle("hidden",
                    button.dataset.category !== "todos" &&
                    item.dataset.category !== button.dataset.category);
            });
        });
    });

    async function loadShop() {
        try {
            const response = await fetch("/api/shop", { credentials: "same-origin", cache: "no-store" });
            if (response.status === 401) {
                authenticated = false;
                message("Faça login para comprar. Os itens e Astras são individuais por conta.");
                if (balanceElement) balanceElement.textContent = "—";
                return;
            }
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Falha ao carregar loja.");
            authenticated = true;
            render(data);
            message("Loja carregada. As compras ficam salvas na sua conta.");
        } catch (error) {
            authenticated = false;
            message(error.message || "Não foi possível carregar a loja.");
        } finally {
            buttonsState();
        }
    }

    for (const button of buyButtons) {
        button.addEventListener("click", async () => {
            if (!authenticated || busy) return;
            busy = true;
            buttonsState();
            try {
                const response = await fetch("/api/shop/buy", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ itemId: button.dataset.itemId })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || "Compra não realizada.");
                render(data);
                message(data.message);
            } catch (error) {
                message(error.message || "Erro ao comprar.");
            } finally {
                busy = false;
                buttonsState();
            }
        });
    }
    buttonsState();
    loadShop();
})();


// ==========================================
// RECUPERAÇÃO DE SENHA
// ==========================================

(() => {
    const requestForm =
        document.getElementById(
            "recoveryRequestForm"
        );

    const verifyForm =
        document.getElementById(
            "recoveryVerifyForm"
        );

    if (!requestForm || !verifyForm) return;

    const emailInput =
        document.getElementById(
            "recoveryEmail"
        );

    const codeInput =
        document.getElementById(
            "recoveryCode"
        );

    const passwordInput =
        document.getElementById(
            "newRecoveryPassword"
        );

    const confirmPasswordInput =
        document.getElementById(
            "confirmRecoveryPassword"
        );

    const requestMessage =
        document.getElementById(
            "recoveryRequestMessage"
        );

    const verifyMessage =
        document.getElementById(
            "recoveryVerifyMessage"
        );

    let recoveryEmail = "";
    let requestInProgress = false;
    let verifyInProgress = false;

    requestForm.addEventListener(
        "submit",
        async event => {
            event.preventDefault();

            if (
                requestInProgress ||
                !requestForm.reportValidity()
            ) {
                return;
            }

            recoveryEmail =
                emailInput.value.trim();

            requestInProgress = true;

            const button =
                requestForm.querySelector(
                    'button[type="submit"]'
                );

            button.disabled = true;
            button.textContent = "ENVIANDO...";

            requestMessage.textContent =
                "Solicitando código...";

            try {
                await avantroxRequest(
                    "/api/password/request-reset",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            email: recoveryEmail
                        })
                    }
                );

                requestMessage.textContent =
                    "Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.";

                verifyForm.hidden = false;
                codeInput.focus();

            } catch (error) {
                requestMessage.textContent =
                    error.message ||
                    "Não foi possível solicitar o código.";

            } finally {
                requestInProgress = false;
                button.disabled = false;
                button.textContent =
                    "ENVIAR CÓDIGO";
            }
        }
    );

    verifyForm.addEventListener(
        "submit",
        async event => {
            event.preventDefault();

            if (
                verifyInProgress ||
                !verifyForm.reportValidity()
            ) {
                return;
            }

            const code =
                codeInput.value.trim();

            const newPassword =
                passwordInput.value;

            const confirmPassword =
                confirmPasswordInput.value;

            if (newPassword.length < 8) {
                verifyMessage.textContent =
                    "A senha precisa ter pelo menos 8 caracteres.";
                return;
            }

            if (
                newPassword !==
                confirmPassword
            ) {
                verifyMessage.textContent =
                    "As senhas não são iguais.";
                return;
            }

            verifyInProgress = true;

            const button =
                verifyForm.querySelector(
                    'button[type="submit"]'
                );

            button.disabled = true;
            button.textContent =
                "VERIFICANDO...";

            verifyMessage.textContent =
                "Verificando código...";

            try {
                await avantroxRequest(
                    "/api/password/reset",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            email: recoveryEmail,
                            code,
                            newPassword
                        })
                    }
                );

                verifyMessage.textContent =
                    "Senha alterada com sucesso! Redirecionando...";

                verifyForm.reset();
                requestForm.reset();

                window.setTimeout(() => {
                    window.location.href =
                        "login.html";
                }, 1800);

            } catch (error) {
                verifyMessage.textContent =
                    error.message ||
                    "Código inválido ou expirado.";

            } finally {
                verifyInProgress = false;
                button.disabled = false;
                button.textContent =
                    "ALTERAR SENHA";
            }
        }
    );
})();


// ==========================================
// MOSTRAR / OCULTAR SENHA
// ==========================================

document.addEventListener(
    "DOMContentLoaded",
    () => {
        const toggleButtons =
            document.querySelectorAll(
                ".toggle-password"
            );

        toggleButtons.forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    const targetId =
                        button.getAttribute(
                            "data-target"
                        );

                    const input =
                        document.getElementById(
                            targetId
                        );

                    if (!input) {
                        console.error(
                            "Campo de senha não encontrado:",
                            targetId
                        );

                        return;
                    }

                    const isHidden =
                        input.type === "password";

                    input.type =
                        isHidden
                            ? "text"
                            : "password";

                    button.setAttribute(
                        "aria-label",
                        isHidden
                            ? "Ocultar senha"
                            : "Mostrar senha"
                    );

                    button.setAttribute(
                        "aria-pressed",
                        String(isHidden)
                    );

                    button.textContent =
                        isHidden
                            ? "◎"
                            : "◉";

                    button.title = isHidden
                        ? "Ocultar senha"
                        : "Mostrar senha";
                }
            );
        });
    }
);

// ==========================================
// FIM DO SCRIPT AVANTROX
// ==========================================


// NAVEGAÇÃO CONFORME LOGIN (LOJA, INÍCIO E DOWNLOAD)
(() => {
    const links = document.querySelectorAll('[data-auth-nav]');
    if (!links.length) return;
    async function updateNavigation() {
        let loggedIn = false;
        try {
            const response = await fetch('/api/auth/me', {
                credentials: 'same-origin', cache: 'no-store'
            });
            loggedIn = response.ok;
        } catch { loggedIn = false; }
        for (const link of links) {
            link.hidden = link.dataset.authNav !== (loggedIn ? 'profile' : 'login');
        }
    }
    updateNavigation();
})();
