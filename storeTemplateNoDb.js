const JsonRestStores = require('jsonreststores')
const HttpMixin = require('jsonreststores/http')

// The store needs
const vars = require('../../vars')

class StoreTemplate extends HttpMixin(JsonRestStores) {
  //
  // The next 3 fields will define the stores' URL, in this case
  // it will be `/stores/2.0.0/storeTemplate/:id`.
  static get publicURLprefix () { return 'stores' }
  static get version () { return '2.0.0' }
  static get publicURL () { return '/storeTemplateNoDb/:id' }

  // This is a unique name for the store. It should match the store name in the URL
  static get storeName () { return 'storeTemplateNoDb' }

  // This is the list of the supported methods.
  // The difference between POST and PUT is that
  // PUT will expect an ID
  static get handleGet () { return true }
  static get handleGetQuery () { return true }
  static get handlePost () { return true }
  static get handlePut () { return true }
  static get handleDelete () { return true }

  // An artificial delay can be specified for testing purposes
  static get artificialDelay () { return vars.artificialDelay }

  // Only non-http errors will be chained to the next middleware.
  // Everything else (HTTP errors) will be handled by the store
  static get chainErrors () { return 'nonhttp' }

  // Methods that MUST be implemented for the store to be functional
  // They need to satisfy the JsonRestStores DB API

  // Input: request.params (with key this.idProperty set)
  // Output: an object
  async implementFetch (request) {
    throw (new Error('implementFetch not implemented, store is not functional'))
  }

  // Input:
  // - request.body
  // Output: an object (saved record)
  async implementInsert (request) {
    throw (new Error('implementInsert not implemented, store is not functional'))
  }

  // Input:
  // - request.params (query)
  // - request.body (data)
  // Output: an object (updated record, refetched)
  async implementUpdate (request) {
    throw (new Error('implementUpdate not implemented, store is not functional'))
  }

  // Input: request.params (with key this.idProperty set)
  // Output: nothing
  async implementDelete (request) {
    throw (new Error('implementDelete not implemented, store is not functional'))
  }

  // Input: request.params, request.options.[conditionsHash,skip,limit,sort]
  // Output: { data: [], grandTotal: ? }
  async implementQuery (request) {
    throw (new Error('implementQuery not implemented, store is not functional'))
  }
}

exports = module.exports = new StoreTemplate()
