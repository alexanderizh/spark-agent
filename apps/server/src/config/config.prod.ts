export default {
  koa: {
    port: Number(process.env.SERVER_PORT) || 7001,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  },
}
