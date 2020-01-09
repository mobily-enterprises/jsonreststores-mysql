const JsonRestStores = require('jsonreststores')
const MysqlMixin = require('jsonreststores-mysql')
const HttpMixin = require('jsonreststores/http')
const Schema = require('simpleschema')

// The store needs
const vars = require('../../vars')

class StoreTemplate extends MysqlMixin(HttpMixin(JsonRestStores)) {
  static get schema () {
    //
    // The schema. This schema has 2 example fields, one boolean and
    // one string
    return new Schema({
      field1: { type: 'boolean', default: false },
      field2: { type: 'string', trim: 16, default: '' },
      field3: { type: 'string', trim: 16, default: '' }
    })
  }

  static get searchSchema () {
    return new Schema({
      // The search schema here matches the schema, but that doesn't have to
      // be the case.
      // Not all fields have to be here; also, not every entry here must be
      // a schema field -- for example `search` is not a schema field
      search: { type: 'string', trim: 16 },
      field1: { type: 'boolean' },
      field2: { type: 'string', trim: 16 },
      field3: { type: 'string', trim: 16 }
    })
  }

  static get artificialDelay () { return vars.artificialDelay }

  static get publicURLprefix () { return 'stores' }
  static get version () { return '2.0.0' }
  static get publicURL () { return '/storeTemplate/:id' }

  static get storeName () { return 'storeTemplate' }

  static get handleGet () { return true }
  static get handleGetQuery () { return true }
  static get handlePost () { return true }
  static get handlePut () { return true }
  static get handleDelete () { return true }

  static get connection () { return vars.connection }
  static get table () { return 'storeTemplate' }

  static get chainErrors () { return 'nonhttp' }

  static get defaultSort () { return { field2: -1 } }
  static get sortableFields () { return ['field1'] }

  // This is an example permission
  async checkPermissions (request) {
    //
    // Permissions might also be based on `request.method`, which can be
    // `put`, `post`, `get`, `getQuery`, `delete`.
    //
    // There is also an 'request.inMethod` function, which can be `implementUpdate`,
    // `implementInsert`, `implementQuery`, `implementFetch` and `implementDelete`.
    //
    // Note that when `request.method` is `put`, it might result in `request.inMethod`
    // being `implementInsert` (a new record) or `implementUpdate` (a new record)

    // No login, no joy
    if (!request.session.loggedIn) return { granted: false }

    // Admins can always do ANYTHING. This is an example.
    if (request.session.flags.isAdmin) return { granted: true }

    // All non-operators: nope
    return { granted: false }
  }

  // This is the heart of everything
  async queryBuilder (request, op, param) {
    let conditions
    let args
    let updateObject
    let insertObject

    switch (op) {
      //
      // GET
      case 'fetch':
        switch (param) {
          case 'fieldsAndJoins':
            return {
              fields: this._fields(),
              joins: this._joins()
            }
          // Conditions on fetch. For example, filter out records
          // that do not belong to the user unless  request.session.isAdmin
          // is set to true
          case 'conditionsAndArgs':
            return {
              conditions: [],
              args: []
            }
        }
        break

      // QUERY
      case 'query':
        switch (param) {
          case 'fieldsAndJoins':
            return {
              fields: this._fields(),
              joins: this._joins()
            }
          case 'conditionsAndArgs':
            conditions = []
            args = []

            // Default conditions depending on searchSchema
            const { defaultConditions, defaultArgs } = await this.defaultConditionsAndArgs(request)  /* eslint-disable-line */
            conditions = [...conditions, defaultConditions]
            args = [...args, defaultArgs]

            // Other keys ()
            const { otherKeysConditions, otherKeysArgs } = this._otherKeysConditionsAndArgs(request) /* eslint-disable-line */
            conditions = [...conditions, otherKeysConditions]
            args = [...args, otherKeysArgs]

            return { conditions, args }
        }
        break

      // INSERT
      case 'insert':
        switch (param) {
          case 'insertObject':
            insertObject = { ...request.body }

            // ...
            // Process insertObject here
            // ...
            return insertObject

          // Extra operations after insert. E.g. insert children records etc.
          case 'after':
            return /* eslint-disable-line */
        }
        break

      // UPDATE
      case 'update':
        switch (param) {
          case 'updateObject':
            updateObject = { ...request.body }

            // ...
            // Process updateObject here
            // ...
            return updateObject
          case 'joins':
            return []

          // Conditions on update. For example, filter out records
          // that do not belong to the user unless  request.session.isAdmin
          // is set to true
          case 'conditionsAndArgs':
            return {
              conditions: [],
              args: []
            }
          // Extra operations after update. E.g. update other tables etc.
          case 'after':
            return /* eslint-disable-line */
        }
        break

      //
      // DELETE
      case 'delete':
        switch (param) {
          case 'tablesAndJoins':
            return {
              tables: [this.table],
              joins: []
            }
          // Conditions on delete. For example, filter out records
          // that do not belong to the user unless  request.session.isAdmin
          // is set to true
          case 'conditionsAndArgs':
            return {
              conditions: [],
              args: []
            }
          case 'after':
            return /* eslint-disable-line */
        }
        break

      // SORT
      case 'sort':
        return this.optionsSort(request)
    }
  }

  // Since `fetch` and `query` would normally return equivalent records, this is
  // provided as an helper function
  _joins () {
    return [
    ]
    /* Examples of what it could be. Each entry should be a separate,
       self contained join
      'LEFT JOIN contacts ON contacts.storeTemplateId = contacts.id',
    ]
    */
  }

  // Since `fetch` and `query` would return the same fields, this is
  // provided as an helper method.
  // NOTE: the fields you can return will also depend on what tables you
  // joined above.
  _fields () {
    return [
      ...this.schemaFields(), /* eslint-disable-line comma-dangle */
      // Some examples:
      // 'contacts.name as contactName',
      // 'contacts.*',
      // "TRIM(CONCAT_WS(' ', contacts.firstName,contacts.lastName,contacts.companyName,c.companyName)) AS name"
    ]
  }

  _otherKeysConditionsAndArgs (request) {
    const otherKeysConditions = []
    const otherKeysArgs = []

    // If the search field is there, add it to the where string AND add arguments
    // Example for a search:
    /*
    const ch = request.options.conditionsHash
    if (ch.search) {
      ch.search.split(' ').forEach((s) => {
        otherKeysConditions.push('(storeTemplate.field1 LIKE ? OR storeTemplate.field2 LIKE ? OR contacts.firstName LIKE ?)')
        // Add one argument per `?` in the query above
        otherKeysArgs.push('%' + s + '%')
        otherKeysArgs.push('%' + s + '%')
        otherKeysArgs.push('%' + s + '%')
      })
    }
    */
    return { otherKeysConditions, otherKeysArgs }
  }

  async transformResult (request, op, data) {
    const record = data

    // Example:
    /*
    switch (op) {
      case 'fetch':
        record.fetched = true
        return record
      case 'query':
        data = data.map(record => {
          record.fetched = true
          return record
        })
    }
    */
    return record
  }
}

exports = module.exports = new StoreTemplate()
