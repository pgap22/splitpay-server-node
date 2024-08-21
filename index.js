import express from "express";
import cors from "cors";
import io from "socket.io-client";
import { prisma } from "./db.js";
import { sumDecimal } from "./decimal.js";
import jwt from "jsonwebtoken";
let id_code_splitpay = "";

(async () => {
  const isCode = await prisma.splitPayCode.findFirst();
  if (isCode) {
    id_code_splitpay = isCode.id;
    return;
  }

  const newCodeSplitPay = await prisma.splitPayCode.create({
    data: {
      code: generateSixDigitNumber(),
    },
  });

  id_code_splitpay = newCodeSplitPay.id;
})();

const app = express();
const sio = io(
  process.env.SOCKETIO_SERVER || "https://splitq-socket-io.onrender.com"
);

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  return res.json({ message: "SplitPay API" });
});

app.get("/authcode", async (req, res) => {
  const { code } = await prisma.splitPayCode.update({
    where: {
      id: id_code_splitpay,
    },
    data: {
      code: generateSixDigitNumber(),
    },
  });
  return res.json({ code });
});

app.post("/auth", async (req, res) => {
  if (!req.body.authcode) {
    return res.status(400).json({ status: "FAILED", reason: "NO_AUTHCODE" });
  }
  if (!req.body.id_user) {
    return res.status(400).json({ status: "FAILED", reason: "NO_ID_USER" });
  }
  const { code: authcode } = await prisma.splitPayCode.findFirst({
    where: {
      id: id_code_splitpay,
    },
  });
  if (authcode !== req.body.authcode) {
    return res
      .status(401)
      .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });
  }

  const token = jwt.sign(
    { splitpay_code: authcode, id_user: req.body.id_user },
    process.env.JWT_SECRET,
    { algorithm: "HS256" }
  );

  const isSession = await prisma.splitPay.findFirst({
    where: {
      id_user: req.body.id_user,
    },
  });

  if (isSession) {
    return res.json({ status: "OK", token });
  }

  await prisma.splitPay.create({
    data: {
      balance: 0,
      id_user: req.body.id_user,
    },
  });

  return  res.json({ status: "OK", token });
});

app.post("/check_authtoken", async (req, res) => {
  const session = await prisma.splitPay.findFirst({
    where: {
      id_user: req.body.id_user,
    },
  });
  if (!session)
    return res
      .status(400)
      .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });

  return  res.json({ status: "OK" });
});

app.post("/deposit", async (req, res) => {
  const session = await prisma.splitPay.findFirst({
    where: {
      id_user: req.body.id_user,
    },
  });
  if (!session)
    return res
      .status(400)
      .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });

  sio.emit("splitpay-value-deposit", req.body.value);

  const currentAmount = session.balance;
  const payloadAmount = req.body.value;

  await prisma.splitPay.updateMany({
    where: {
      id_user: session.id_user,
    },
    data: {
      balance: sumDecimal(currentAmount, payloadAmount),
    },
  });

  return res.json({ message: "OK" });
});

app.post("/finalize_deposit", async (req, res) => {
  try {
    const session = await prisma.splitPay.findFirst({
      where: {
        id_user: req.body.id_user,
      },
    });
    if (!session)
      return res
        .status(400)
        .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });

    sio.emit("splitpay-disconnect", "bye");
    if (session.balance !== 0) {
      await prisma.recharges.create({
        data: {
          userID: session.id_user,
          balance: session.balance,
          type: "splitpay",
        },
      });
      await prisma.users.update({
        where: { id: session.id_user },
        data: {
          balance: {
            increment: session.balance,
          },
        },
      });
    }

    await prisma.splitPay.delete({
      where: {
        id: session.id,
      },
    });

    return res.json({ status: "OK" });
  } catch (e) {
    console.error(e);
    res.status(400).json({ status: "FAILED", reason: "SERVER_ERROR" });
  }
});

app.listen(5001, () => {
  console.log("We are ready on 5001");
});

function generateSixDigitNumber() {
  return "" + Math.floor(100000 + Math.random() * 900000);
}
