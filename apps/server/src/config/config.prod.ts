export default {
  koa: {
    port: 7001,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
}
