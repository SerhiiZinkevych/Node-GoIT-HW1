const bcrypt = require("bcryptjs");
const usersModel = require("../users/users.model");
const jwt = require("jsonwebtoken");
const { UnauthorizedError } = require("../helpers/errors.constructors");
const {
  generateAvatar,
} = require("../helpers/avatarGenerator/avatarGenerator");
const { v4: uuidv4 } = require("uuid");

class AuthController {
  constructor() {
    this._costFactor = 6;
  }

  get register() {
    return this._register.bind(this);
  }

  async _register(req, res, next) {
    try {
      const { email, password, gender } = req.body;

      const user = await usersModel.findUserByEmail(email);
      if (user) {
        return res.status(409).json({ message: "Email in use" });
      }

      const passwordHash = await bcrypt.hash(password, this._costFactor);

      const avatarURL = await generateAvatar(req);

      const newUser = await usersModel.create({
        email,
        password: passwordHash,
        gender,
        avatarURL,
        verificationToken: uuidv4(),
      });

      await this.sendVerificationEmail(
        newUser.email,
        newUser.verificationToken
      );

      if (newUser) {
        res.status(201).json({
          user: {
            email: newUser.email,
            subscription: newUser.subscription,
            gender: newUser.gender,
            avatarURL: newUser.avatarURL,
          },
        });
      }
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const user = await usersModel.findUserByEmail(email);

      if (!user) {
        throw new UnauthorizedError("Email or password is wrong");
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        throw new UnauthorizedError("Email or password is wrong");
      }

      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
      const updatedUser = await usersModel.updateToken(user._id, token);

      return res.status(200).json({
        token: updatedUser.token,
        user: {
          email: updatedUser.email,
          subscription: updatedUser.subscription,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  async authorize(req, res, next) {
    try {
      const authHeader = req.get("Authorization");
      if (!authHeader) {
        throw new UnauthorizedError("Token not found");
      }
      const token = authHeader.replace("Bearer ", "");

      let userId;

      try {
        userId = await jwt.verify(token, process.env.JWT_SECRET).id;
      } catch (err) {
        next(new UnauthorizedError("Not authorized"));
      }

      const user = await usersModel.findById(userId);

      if (!user || user.token !== token) {
        throw new UnauthorizedError("Not authorized");
      }

      req.user = user;
      req.token = token;
      next();
    } catch (err) {
      next(err);
    }
  }

  async logout(req, res, next) {
    try {
      const user = req.user;
      await usersModel.updateToken(user._id, null);
      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
  async tokenVerification(req, res, next) {
    try {
      const token = req.params.verificationToken;
      const userToVerify = await usersModel.findOne({
        verificationToken: token,
      });
      if (!userToVerify) {
        return res.status(404).json({ message: "User not found" });
      }
      const updatedUser = await usersModel.findUserByIdAndUpdate(
        userToVerify._id,
        {
          verificationToken: null,
        }
      );
      if (!updatedUser) {
        return res.status(500).send("Internal server error");
      }
      return res.status(200).send("Verification successful!");
    } catch (err) {
      next(err);
    }
  }
  async sendVerificationEmail(email, token) {
    const sgMail = require("@sendgrid/mail");
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    const msg = {
      to: email,
      from: "zinkevych@gmail.com",
      subject: "Please verify your account",
      html: `<a href="${process.env.HOST_NAME}/auth/verify/${token}">Click this link to verify your account</a>`,
    };
    sgMail.send(msg);
  }
}

module.exports = new AuthController();
