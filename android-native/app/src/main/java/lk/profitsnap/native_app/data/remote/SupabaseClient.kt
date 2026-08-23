package lk.profitsnap.native_app.data.remote

import kotlinx.coroutines.runBlocking
import lk.profitsnap.native_app.BuildConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * Every PostgREST request needs both the project's `apikey` header (the
 * public anon key — safe to ship in the app, same as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * in the web app) and, once signed in, `Authorization: Bearer <access_token>`
 * so Postgres RLS policies can see `auth.uid()` and scope rows to the
 * correct tenant — identical security model to the web app, just without a
 * browser cookie jar doing it for us.
 */
private class AuthHeaderInterceptor(private val sessionStore: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = runBlocking { sessionStore.currentAccessToken() }
        val request = chain.request().newBuilder()
            .addHeader("apikey", BuildConfig.SUPABASE_ANON_KEY)
            .addHeader("Authorization", "Bearer ${token ?: BuildConfig.SUPABASE_ANON_KEY}")
            .addHeader("Content-Type", "application/json")
            .build()
        return chain.proceed(request)
    }
}

object SupabaseClient {

    fun postgrest(sessionStore: SessionStore): Retrofit {
        val client = OkHttpClient.Builder()
            .addInterceptor(AuthHeaderInterceptor(sessionStore))
            .addInterceptor(HttpLoggingInterceptor().apply {
                level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
                        else HttpLoggingInterceptor.Level.NONE
            })
            .build()

        return Retrofit.Builder()
            .baseUrl("${BuildConfig.SUPABASE_URL}/rest/v1/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    fun auth(): Retrofit {
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request().newBuilder()
                    .addHeader("apikey", BuildConfig.SUPABASE_ANON_KEY)
                    .addHeader("Content-Type", "application/json")
                    .build()
                chain.proceed(request)
            }
            .build()

        return Retrofit.Builder()
            .baseUrl("${BuildConfig.SUPABASE_URL}/auth/v1/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }
}
