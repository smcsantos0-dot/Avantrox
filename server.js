
// ==========================================
// AVANTROX - SERVIDOR PRINCIPAL
// ==========================================

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { rateLimit } = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIGURAÇÕES
// ==========================================

app.use(express.json({ limit: "10kb" }));

// ==========================================
// BANCO DE DADOS SQLITE
// ==========================================

const dataDirectory = path.join(
    __dirname,
    "..",
    "avantrox-data"
);

if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, {
        recursive: true
    });
}

const db = new Database(
    path.join(dataDirectory, "avantrox.sqlite")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password TEXT NOT NULL,
        player_class TEXT NOT NULL DEFAULT 'Guerreiro',
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// Migração de contas antigas

const columns = db.prepare(
    "PRAGMA table_info(users)"
).all();

const columnNames = columns.map(
    column => column.name
);

if (!columnNames.includes("player_class")) {
    db.exec(`
        ALTER TABLE users
        ADD COLUMN player_class TEXT
        NOT NULL DEFAULT 'Guerreiro'
    `);
}

if (!columnNames.includes("level")) {
    db.exec(`
        ALTER TABLE users
        ADD COLUMN level INTEGER
        NOT NULL DEFAULT 1
    `);
}

if (!columnNames.includes("xp")) {
    db.exec(`
        ALTER TABLE users
        ADD COLUMN xp INTEGER
        NOT NULL DEFAULT 0
    `);
}

// ==========================================
// BANCO DE MISSÕES
// ==========================================

db.exec(`
    CREATE TABLE IF NOT EXISTS completed_missions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        mission_id TEXT NOT NULL,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, mission_id),
        FOREIGN KEY(user_id)
            REFERENCES users(id)
            ON DELETE CASCADE
    );
`);

// ==========================================
// SESSÕES
// ==========================================

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
    console.warn(
        "AVISO: configure SESSION_SECRET para utilizar em produção."
    );
}

app.use(session({
    name: "avantrox.sid",
    secret: sessionSecret ||
        crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// ==========================================
// LIMITADOR DE TENTATIVAS
// ==========================================

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        error: "Muitas tentativas. Aguarde alguns minutos."
    }
});

// ==========================================
// SISTEMA DE EXPERIÊNCIA
// ==========================================

function getRequiredXP(level) {
    return level * 100;
}

function addExperience(userId, amount) {
    const reward = amount;

    if (
        !Number.isSafeInteger(reward) ||
        reward <= 0 ||
        reward > 1000000
    ) {
        throw new Error("Quantidade de XP inválida.");
    }

    const updateProgress = db.transaction(() => {
        const user = db.prepare(`
            SELECT level, xp
            FROM users
            WHERE id = ?
        `).get(userId);

        if (!user) {
            throw new Error("Jogador não encontrado.");
        }

        let level = user.level;
        let xp = user.xp + reward;
        let levelsGained = 0;

        while (xp >= getRequiredXP(level)) {
            xp -= getRequiredXP(level);
            level++;
            levelsGained++;
        }

        db.prepare(`
            UPDATE users
            SET level = ?, xp = ?
            WHERE id = ?
        `).run(level, xp, userId);

        return {
            level,
            xp,
            xpNeeded: getRequiredXP(level),
            levelsGained,
            canChangeClass:
                level >= 50 && level % 50 === 0
        };
    });

    return updateProgress();
}

// ==========================================
// MISSÕES - AVANTROX
// ==========================================

const MISSIONS = {
    first_login: {
        name: "Primeira Jornada",
        description:
            "Entre na sua conta pela primeira vez.",
        xp: 100
    },

    view_profile: {
        name: "Conhecendo seu Personagem",
        description:
            "Acesse seu perfil de jogador.",
        xp: 150
    },

    view_progression: {
        name: "O Caminho do Guerreiro",
        description:
            "Consulte sua progressão.",
        xp: 200
    }
};

// ==========================================
// CONCLUIR MISSÃO
// ==========================================

// Esta função é chamada apenas pelo servidor.
// O jogador não pode informar XP ou escolher
// diretamente uma missão para receber recompensa.

const completeMission = db.transaction(
    (userId, missionId) => {
        const mission = MISSIONS[missionId];

        if (!mission) {
            throw new Error("Missão inexistente.");
        }

        const result = db.prepare(`
            INSERT OR IGNORE INTO completed_missions
            (user_id, mission_id)
            VALUES (?, ?)
        `).run(userId, missionId);

        if (result.changes === 0) {
            return {
                completed: false,
                message: "Missão já concluída."
            };
        }

        const progression = addExperience(
            userId,
            mission.xp
        );

        return {
            completed: true,
            mission: mission.name,
            xpEarned: mission.xp,
            progression
        };
    }
);

// ==========================================
// SESSÃO DO JOGADOR
// ==========================================

function createPlayerSession(req, res, user) {
    req.session.regenerate(error => {
        if (error) {
            return res.status(500).json({
                error: "Não foi possível iniciar sua sessão."
            });
        }

        req.session.userId = user.id;

        req.session.save(saveError => {
            if (saveError) {
                return res.status(500).json({
                    error: "Não foi possível salvar sua sessão."
                });
            }

            try {
                const missionResult = completeMission(
                    user.id,
                    "first_login"
                );

                if (missionResult.completed) {
                    console.log(
                        `${user.username} concluiu Primeira Jornada: +100 XP`
                    );
                }
            } catch (missionError) {
                console.error(
                    "Erro na missão de login:",
                    missionError
                );
            }

            res.json({
                success: true,
                message:
                    "Autenticação realizada com sucesso!",
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email
                }
            });
        });
    });
}

// ==========================================
// VERIFICAR AUTENTICAÇÃO
// ==========================================

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            error: "Você precisa fazer login."
        });
    }

    next();
}

// ==========================================
// CADASTRO
// ==========================================

app.post(
    "/api/auth/register",
    authLimiter,
    async (req, res) => {
        try {
            const {
                username,
                email,
                password
            } = req.body || {};

            if (
                typeof username !== "string" ||
                typeof email !== "string" ||
                typeof password !== "string"
            ) {
                return res.status(400).json({
                    error: "Preencha todos os campos."
                });
            }

            const cleanUsername = username.trim();
            const cleanEmail = email.trim().toLowerCase();

            if (
                !/^[\p{L}\p{N}_-]{3,20}$/u.test(
                    cleanUsername
                )
            ) {
                return res.status(400).json({
                    error:
                        "O nick deve ter de 3 a 20 caracteres."
                });
            }

            if (
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
                    cleanEmail
                )
            ) {
                return res.status(400).json({
                    error: "Digite um e-mail válido."
                });
            }

            if (
                password.length < 8 ||
                password.length > 72
            ) {
                return res.status(400).json({
                    error:
                        "A senha deve ter entre 8 e 72 caracteres."
                });
            }

            const existingUser = db.prepare(`
                SELECT id FROM users
                WHERE username = ? OR email = ?
            `).get(cleanUsername, cleanEmail);

            if (existingUser) {
                return res.status(409).json({
                    error:
                        "Este nick ou e-mail já está cadastrado."
                });
            }

            const hashedPassword = await bcrypt.hash(
                password,
                12
            );

            const result = db.prepare(`
                INSERT INTO users
                (username, email, password)
                VALUES (?, ?, ?)
            `).run(
                cleanUsername,
                cleanEmail,
                hashedPassword
            );

            const user = {
                id: Number(result.lastInsertRowid),
                username: cleanUsername,
                email: cleanEmail
            };

            createPlayerSession(req, res, user);

        } catch (error) {
            console.error("Erro no cadastro:", error);

            if (
                error.code === "SQLITE_CONSTRAINT_UNIQUE"
            ) {
                return res.status(409).json({
                    error:
                        "Este nick ou e-mail já está cadastrado."
                });
            }

            res.status(500).json({
                error: "Erro interno ao criar sua conta."
            });
        }
    }
);

// ==========================================
// LOGIN
// ==========================================

app.post(
    "/api/auth/login",
    authLimiter,
    async (req, res) => {
        try {
            const {
                identifier,
                password
            } = req.body || {};

            if (
                typeof identifier !== "string" ||
                typeof password !== "string" ||
                identifier.length > 254 ||
                password.length < 1 ||
                password.length > 72
            ) {
                return res.status(400).json({
                    error:
                        "Informe seu nick ou e-mail e sua senha."
                });
            }

            const cleanIdentifier = identifier.trim();

            const user = db.prepare(`
                SELECT *
                FROM users
                WHERE username = ? COLLATE NOCASE
                OR email = ? COLLATE NOCASE
            `).get(
                cleanIdentifier,
                cleanIdentifier
            );

            if (!user) {
                return res.status(401).json({
                    error:
                        "Nick, e-mail ou senha incorretos."
                });
            }

            const passwordMatches = await bcrypt.compare(
                password,
                user.password
            );

            if (!passwordMatches) {
                return res.status(401).json({
                    error:
                        "Nick, e-mail ou senha incorretos."
                });
            }

            createPlayerSession(req, res, user);

        } catch (error) {
            console.error("Erro no login:", error);

            res.status(500).json({
                error:
                    "Erro interno ao realizar login."
            });
        }
    }
);

// ==========================================
// DADOS DO JOGADOR
// ==========================================

app.get(
    "/api/auth/me",
    requireAuth,
    (req, res) => {
        try {
            const user = db.prepare(`
                SELECT
                    id,
                    username,
                    email,
                    player_class,
                    level,
                    xp,
                    created_at
                FROM users
                WHERE id = ?
            `).get(req.session.userId);

            if (!user) {
                return res.status(401).json({
                    error: "Conta não encontrada."
                });
            }

            // Missão de conhecer o perfil
            try {
                completeMission(
                    req.session.userId,
                    "view_profile"
                );
            } catch (error) {
                console.error(
                    "Erro na missão do perfil:",
                    error
                );
            }

            // Buscar dados atualizados após a recompensa
            const updatedUser = db.prepare(`
                SELECT
                    id,
                    username,
                    email,
                    player_class,
                    level,
                    xp,
                    created_at
                FROM users
                WHERE id = ?
            `).get(req.session.userId);

            res.json({
                authenticated: true,
                user: updatedUser
            });

        } catch (error) {
            console.error(
                "Erro ao carregar jogador:",
                error
            );

            res.status(500).json({
                error:
                    "Não foi possível carregar seu perfil."
            });
        }
    }
);

// ==========================================
// PROGRESSÃO DO JOGADOR
// ==========================================

app.get(
    "/api/player/progression",
    requireAuth,
    (req, res) => {
        try {
            // Missão de consultar a progressão
            try {
                completeMission(
                    req.session.userId,
                    "view_progression"
                );
            } catch (error) {
                console.error(
                    "Erro na missão de progressão:",
                    error
                );
            }

            const user = db.prepare(`
                SELECT level, xp
                FROM users
                WHERE id = ?
            `).get(req.session.userId);

            if (!user) {
                return res.status(404).json({
                    error: "Jogador não encontrado."
                });
            }

            const xpNeeded = getRequiredXP(user.level);

            res.json({
                level: user.level,
                xp: user.xp,
                xpNeeded,
                progress: Math.floor(
                    (user.xp / xpNeeded) * 100
                ),
                canChangeClass:
                    user.level >= 50 &&
                    user.level % 50 === 0
            });

        } catch (error) {
            console.error(
                "Erro na progressão:",
                error
            );

            res.status(500).json({
                error:
                    "Não foi possível carregar a progressão."
            });
        }
    }
);

// ==========================================
// LISTAR MISSÕES
// ==========================================

app.get(
    "/api/player/missions",
    requireAuth,
    (req, res) => {
        try {
            const completed = db.prepare(`
                SELECT
                    mission_id,
                    completed_at
                FROM completed_missions
                WHERE user_id = ?
            `).all(req.session.userId);

            const completedMap = new Map(
                completed.map(item => [
                    item.mission_id,
                    item.completed_at
                ])
            );

            const missions = Object.entries(
                MISSIONS
            ).map(([id, mission]) => ({
                id,
                name: mission.name,
                description: mission.description,
                xp: mission.xp,
                completed: completedMap.has(id),
                completedAt:
                    completedMap.get(id) || null
            }));

            res.json({
                success: true,
                missions
            });

        } catch (error) {
            console.error(
                "Erro ao listar missões:",
                error
            );

            res.status(500).json({
                error:
                    "Não foi possível carregar as missões."
            });
        }
    }
);

// ==========================================
// TESTE DE XP
// SOMENTE DESENVOLVIMENTO
// ==========================================

app.post(
    "/api/player/xp/test",
    requireAuth,
    (req, res) => {
        if (
            process.env.NODE_ENV === "production" ||
            process.env.ENABLE_TEST_XP !== "true"
        ) {
            return res.status(404).json({
                error: "Rota não encontrada."
            });
        }

        try {
            const amount = Number(
                req.body && req.body.amount
            );

            if (
                !Number.isSafeInteger(amount) ||
                amount < 1 ||
                amount > 10000
            ) {
                return res.status(400).json({
                    error:
                        "Informe uma quantidade entre 1 e 10000 XP."
                });
            }

            const progression = addExperience(
                req.session.userId,
                amount
            );

            res.json({
                success: true,
                message: "Experiência adicionada!",
                ...progression
            });

        } catch (error) {
            console.error(
                "Erro ao adicionar XP:",
                error
            );

            res.status(500).json({
                error:
                    "Não foi possível adicionar experiência."
            });
        }
    }
);

// ==========================================
// SAIR DA CONTA
// ==========================================

app.post(
    "/api/auth/logout",
    requireAuth,
    (req, res) => {
        req.session.destroy(error => {
            if (error) {
                return res.status(500).json({
                    error:
                        "Não foi possível sair da conta."
                });
            }

            res.clearCookie("avantrox.sid");

            res.json({
                success: true,
                message: "Você saiu da sua conta."
            });
        });
    }
);

// ==========================================
// PROTEGER PÁGINA DE PERFIL
// ==========================================

app.get(
    "/perfil.html",
    requireAuth,
    (req, res) => {
        res.sendFile(
            path.join(__dirname, "perfil.html")
        );
    }
);

// ==========================================
// ARQUIVOS DO SITE
// ==========================================

app.use(express.static(__dirname));

// ==========================================
// INICIAR SERVIDOR
// ==========================================

app.listen(PORT, () => {
    console.log(
        "ARQUIVO ATUALIZADO DO AVANTROX CARREGADO!"
    );

    console.log(
        "TESTE XP:",
        process.env.ENABLE_TEST_XP
    );

    console.log("--------------------------------");
    console.log("       AVANTROX ONLINE");
    console.log("--------------------------------");
    console.log(`Servidor: http://localhost:${PORT}`);
    console.log("Autenticação inicializada!");
    console.log("Banco de dados conectado!");
    console.log("Sistema de XP inicializado!");
    console.log("Sistema de missões inicializado!");
});
