export { StorageAdapter, STORAGE_ADAPTER, Commit } from './storage-adapter.interface';
export { LocalFSAdapter, isAtomicWriteTmpPath } from './local-fs.adapter';
export { GitAdapter } from './git.adapter';
export { RoutingStorageAdapter, CrossPersonalMoveError } from './routing-fs.adapter';
export { StorageModule } from './storage.module';
