import jwt from "jsonwebtoken";
import { prisma } from "./db.js";
// Middleware to verify JWT token
const auth_middleware = async (req, res, next) => {
  try {
    // Retrieve the token from the Authorization header
    const authHeader = req.headers.authorization;

    if (authHeader) {
      // Assuming the token is in the format: "Bearer <token>"
      const token = authHeader.split(" ")[1];

      const data = jwt.verify(token, process.env.JWT_SECRET);
      console.log(data.key);
      if (!data) {
        return res.status(403).json({ error: "NOT AUTH" });
      }

      const splitpay = await prisma.splitPay.findFirst({
        where: {
          key: data.key,
        },
      });

      if (!splitpay) {
        return res.status(403).json({ error: "NOT AUTH" });
      }
      console.log(splitpay);
      // Attach the decoded user information to the request object
      req.splitPay = splitpay;
      next(); // Proceed to the next middleware or route handler
    } else {
      res.status(401).json({ error: "NOT AUTH" }); // Unauthorized if no token is provided
    }
  } catch (error) {
    res.status(401).json({ error: "NOT AUTH" }); // Unauthorized if no token is provided
  }
};

export { auth_middleware };
