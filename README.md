JsonRestStores-mysql
====================


# DOCUMENTATION TAKEN OUT OF JSONRESTSTORES AFTER THE SPLIT

* Don't specify `paramIds` in schema. They will be added to the schema as `{type: 'id' }` automatically
* Don't specify `searchSchema`. It will be worked out taking all schema element marked as `searchable: true` (except paramIds)

* [SimpleSchema - Github](https://github.com/mercmobily/SimpleSchema). This module makes it easy (and I mean, really easy) to define a schema and validate/cast data against it. It's really simple to extend a schema as well. It's a no-fuss module.


-------------------------------------

## Custom `searchSchema`

In JsonRestStores you actually define what fields are acceptable as filters in `implementQuery` (specifically, `request.options.conditions`) with the property `searchSchema`, which is defined exactly as a schema. So, writing this is equivalent to the code just above:

    // Basic definition of the managers store
    class Managers extends HTTPMixin(Store) {
      static get schema () {
        return new Schema({
          name: { type: 'string', trim: 60 },
          surname: { type: 'string', searchable: true, trim: 60 }
        })
      }

      searchSchema: new Schema( {
        surname: { type: 'string', trim: 60 },
      }),

      static get storeName () { return 'managers' }
      static get publicURL () { return '/managers/:id' }

      static get handlePut () { return true }
      static get handlePost () { return true }
      static get handleGet () { return true }
      static get handleGetQuery () { return true }
      static get handleDelete () { return true }

      // ...implement??? functions
    }

If `searchSchema` is not defined, JsonRestStores will create one based on your main schema by doing a shallow copy, excluding `paramIds` (which means that, in this case, `id` is not added automatically to `searchSchema`, which is most likely what you want).

If you define your own `searchSchema`, you are able to decide exactly how you want to filter the values. For example you could define a different default, or trim value, etc. You might also have fields that will create more complex queries. For example:

    // Basic definition of the managers store
    class Managers extends HTTPMixin(Store) {
      static get schema () {
        return new Schema({
          name: { type: 'string', searchable: true, trim: 60 },
          surname: { type: 'string', searchable: true, trim: 60 }
        })
      }

      searchSchema: new Schema( {
        surname: { type: 'string', trim: 60 },
        name: { type: 'string', trim: 60 },
        anyField: { type: string, trim: 60 }
      }),

      static get storeName () { return 'managers' }
      static get publicURL () { return '/managers/:id' }

      static get handlePut () { return true }
      static get handlePost () { return true }
      static get handleGet () { return true }
      static get handleGetQuery () { return true }
      static get handleDelete () { return true }

      async implementQuery (request) {
        // request.options.conditions might have 'any', which should generate
        // an SQL query checking both name and surname
      }

      // ...implement??? functions
    }

----------------------------------------------

# Permissions

Every rest method runs `checkPermissions()` in order to check permissions. If everything is fine, `checkPermissions()`  returns `true`; if it returns `false`, along with a message, it means that permission wasn't granted.

The `checkPermissions()` method has the following signature:

    checkPermissions: function( request, method)

Here:

* `request`. It is the request object
* `method`. It can be `post`, `put`, `get`, `getQuery`, `delete`

Here is an example of a store only allowing deletion only to specific admin users:

Note that if your store is derived from another one, and you want to preserve the parent store's permission model, you can run `super.checkPermissions()`:

      async checkPermissions (request, method) {

        // Run the parent's permission check. If it failed, honour the failure
        let { granted, message } = super.checkPermissions(request, method)
        if (!granted) return { granted: true }

        // We are only adding checks for  `put`.
        // In any other case, will go along with the parent's response
        if (method === 'put') return { granted: true }

        // User is admin (id: 1 )
        if( request.session.user === 1){ return { granted: true }
        else return { granted: false, message: 'Only admin can do this'}
      },

Please note that `checkPermissions()` is only run for local requests, with `remote` set to false. All requests coming from APIs will ignore the method.

-----------------------------------------------

## A note on `publicURL` and `paramIds`

When you define a store like this:

    var Managers = declare( Store, {

      schema: new Schema({
        name   : { type: 'string', trim: 60 },
        surname: { type: 'string', trim: 60 },
      }),

      storeName: 'managers',
      publicURL: '/managers/:id',

      handlePut: true,
      handlePost: true,
      handleGet: true,
      handleGetQuery: true,
      handleDelete: true,

      hardLimitOnQueries: 50,
    });

    managers.protocolListen( 'HTTP', { app: app } );;

The `publicURL` is used to:

* Add `id: { type: id }` to the schema automatically. This is done so that you don't have to do the grunt work of defining `id` in the schema if they are already in `publicURL`.
* Create the `paramIds` array for the store. In this case, `paramIds` will be `[ 'id' ]`.

So, you could reach the same goal without `publicURL`:

    // Basic definition of the managers store
    class Managers extends HTTPMixin(Store) {
      static get schema () {
        return new Schema({
          id: { type: 'id' },
          name: { type: 'string', searchable: true, trim: 60 },
          surname: { type: 'string', trim: 60 }
        })
      }

      static get paramIds () { return [ 'id' ] }

      static get storeName () { return 'managers' }
      static get publicURL () { return '/managers/:id' }

      static get handlePut () { return true }
      static get handlePost () { return true }
      static get handleGet () { return true }
      static get handleGetQuery () { return true }
      static get handleDelete () { return true }
      // ...implement??? functions
    }

Note that:
 * The `id` parameter had to be defined in the schema
 * The `paramIds` array had to be defined by hand
 * `managers.protocolListenHTTP({ app: app } );` can't be used as the public URL is not there

In any case, the property `idProperty` is set as last element of `paramIds`; in this example, it is `id`.

*/

/*
  Schema options
    * searchable (added to searchSchema automatically if searchSchema not set)
    * silent (not fetched in query and fetch if true)
*/
