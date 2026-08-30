import nativeVersion from './native-version.json' with { type: 'json' }

export const NATIVE_HOST_PROTOCOL_VERSION = nativeVersion.protocolVersion as 1
export const NATIVE_HOST_VERSION = nativeVersion.hostVersion
