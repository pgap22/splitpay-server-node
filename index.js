import express from "express";
import cors from "cors";
import io from "socket.io-client";
import { prisma } from "./db.js";
import { sumDecimal } from "./decimal.js";
import jwt from "jsonwebtoken";
import { auth_middleware } from "./auth_middlware.js";

const app = express();
const sio = io(
  process.env.SOCKETIO_SERVER || "https://splitq-socket-io.onrender.com"
);

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  return res.json({ message: "SplitPay API" });
});
app.get("/verify_splitpay", auth_middleware, async (req, res) => {
  try {
    await prisma.splitPay.update({
      where: {
        id: req.splitPay.id,
      },
      data: {
        status: "active",
      },
    });
    return res.json({ ok: "ok" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: "error" });
  }
});
app.get("/get_splitpay", auth_middleware, (req,res)=>{
  return res.json({...req.splitPay})
})
app.get("/authcode", auth_middleware, async (req, res) => {
  const splitPay = await prisma.splitPay.update({
    where: {
      id: req.splitPay.id,
    },
    data: {
      accesCode: generateSixDigitNumber(),
    },
  });

  return res.json({ code: splitPay.accesCode });
});
app.post("/auth", async (req, res) => {
  if (!req.body.authcode) {
    return res.status(400).json({ status: "FAILED", reason: "NO_AUTHCODE" });
  }
  if (!req.body.token_jwt) {
    return res.status(400).json({ status: "FAILED", reason: "NO_ID_USER" });
  }

  const { id: id_user } = jwt.verify(
    req.body.token_jwt,
    process.env.JWT_SECRET
  );

  if (!id_user)
    return res.status(403).json({ status: "FAILED", error: "NO_ID_USER" });

  const splitPay = await prisma.splitPay.findFirst({
    where: {
      accesCode: req.body.authcode,
    },
  });

  if (!splitPay)
    return res
      .status(403)
      .json({ status: "FAILED", error: "AUTHCODE_INVALID" });

  let token = "";

  const isSession = await prisma.splitPaySession.findFirst({
    where: {
      AND: [{ id_user: req.body.id_user }, { id_splitpay: splitPay.id }],
    },
  });


  if (isSession) {
    token = jwt.sign({ splitpay_session: isSession.id },process.env.JWT_SECRET);
    return res.json({ status: "OK", token });
  }

  const splitPaySession = await prisma.splitPaySession.create({
    data: {
      balance: 0,
      id_user: id_user,
      id_splitpay: splitPay.id,
    },
  });

  token = jwt.sign({ splitpay_session: splitPaySession.id }, process.env.JWT_SECRET);

  return res.json({ status: "OK", token });
});
app.post("/check_authtoken", async (req, res) => {
  if (!req.body.splitpayjwt) {
    return res
      .status(400)
      .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });
  }

  const { splitpay_session } = jwt.verify(
    req.body.splitpayjwt,
    process.env.JWT_SECRET
  );

  if (!splitpay_session)
    return res
      .status(403)
      .json({ status: "FAILED", error: "AUTHCODE_INVALID" });

  const session = await prisma.splitPaySession.findFirst({
    where: {
      id: splitpay_session,
    },
  });
  if (!session)
    return res
      .status(400)
      .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });

  return res.json({ status: "OK" });
});
app.post("/deposit", async (req, res) => {
  if (!req.body.splitpayjwt) {
    return res
      .status(400)
      .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });
  }

  const { splitpay_session } = jwt.verify(
    req.body.splitpayjwt,
    process.env.JWT_SECRET
  );

  if (!splitpay_session)
    return res
      .status(403)
      .json({ status: "FAILED", error: "AUTHCODE_INVALID" });

  const session = await prisma.splitPaySession.findFirst({
    where: {
      id: splitpay_session,
    },
  });

  if (!session)
    return res
      .status(400)
      .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });

  sio.emit("splitpay-value-deposit", req.body.value);

  const currentAmount = session.balance;
  const payloadAmount = req.body.value;

  await prisma.splitPaySession.update({
    where: {
      id: splitpay_session,
    },
    data: {
      balance: sumDecimal(currentAmount, payloadAmount),
    },
  });

  return res.json({ message: "OK" });
});
app.post("/deposit_splitpay", auth_middleware, async (req, res) => {
  const session = await prisma.splitPaySession.findFirst({
    where: {
      id_splitpay: req.splitPay.id,
    },
  });
  if (!session)
    return res
      .status(400)
      .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });

  sio.emit("splitpay-value-deposit", req.body.value);

  const currentAmount = session.balance;
  const payloadAmount = req.body.value;

  await prisma.splitPaySession.updateMany({
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
    if (!req.body.splitpayjwt) {
      return res
        .status(400)
        .json({ status: "FAILED", reason: "AUTHCODE_INVALID" });
    }

    const { splitpay_session } = jwt.verify(
      req.body.splitpayjwt,
      process.env.JWT_SECRET
    );

    if (!splitpay_session)
      return res
        .status(403)
        .json({ status: "FAILED", error: "AUTHCODE_INVALID" });

    const session = await prisma.splitPaySession.findFirst({
      where: {
        id: splitpay_session,
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

    await prisma.splitPaySession.delete({
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
